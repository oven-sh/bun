#include "root.h"

#include "LineIndex.h"

#include "ZigGlobalObject.h"
#include <JavaScriptCore/JSArrayBufferView.h>
#include <JavaScriptCore/JSCJSValue.h>
#include <JavaScriptCore/FunctionExecutable.h>
#include <JavaScriptCore/JSCast.h>
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/JSGenericTypedArrayViewInlines.h>
#include <JavaScriptCore/JSTypedArrays.h>

extern "C" size_t highway_index_of_char(const uint8_t* haystack, size_t haystack_len, uint8_t needle);
extern "C" size_t highway_last_index_of_char(const uint8_t* haystack, size_t haystack_len, uint8_t needle);
extern "C" size_t highway_count_char(const uint8_t* haystack, size_t haystack_len, uint8_t needle);

namespace Bun {

LineIndex::~LineIndex()
{
    delete m_table.load(std::memory_order_relaxed);
}

// A line ends at `\n`, and at a `\r` that no `\n` follows, as in JSC::LineStartTable::build().
void LineIndex::scan(std::span<const Latin1Character> text, size_t begin, size_t end, bool hasCarriageReturn, Checkpoint& state)
{
    size_t length = end - begin;
    if (!length)
        return;

    const uint8_t* start = text.data() + begin;
    bool scalar = length < 32;
    if (!scalar && hasCarriageReturn)
        scalar = highway_index_of_char(start, length, '\r') != length;

    if (scalar) {
        for (size_t i = begin; i < end; i++) {
            uint8_t character = text[i];
            if (character == '\n' || (character == '\r' && (i + 1 == text.size() || text[i + 1] != '\n'))) {
                state.line++;
                state.lineStart = static_cast<unsigned>(i + 1);
            }
        }
        return;
    }

    size_t count = highway_count_char(start, length, '\n');
    if (!count)
        return;
    state.line += static_cast<unsigned>(count);
    state.lineStart = static_cast<unsigned>(begin + highway_last_index_of_char(start, length, '\n') + 1);
}

LineIndex::Table* LineIndex::build(std::span<const Latin1Character> text)
{
    auto* table = new Table;
    table->length = text.size();
    table->hasCarriageReturn = !text.empty() && highway_index_of_char(text.data(), text.size(), '\r') != text.size();

    size_t count = (text.size() >> blockShift) + 1;
    table->checkpoints.reserveInitialCapacity(count);
    Checkpoint state;
    for (size_t block = 0; block < count; block++) {
        table->checkpoints.append(state);
        size_t begin = block << blockShift;
        scan(text, begin, std::min(text.size(), begin + blockSize), table->hasCarriageReturn, state);
    }
    return table;
}

bool LineIndex::lineAndColumn(WTF::StringView text, unsigned offset, unsigned& line, unsigned& column)
{
    if (!text.is8Bit())
        return false;
    auto characters = text.span8();

    Table* table = m_table.load(std::memory_order_acquire);
    if (!table) [[unlikely]] {
        Table* built = build(characters);
        if (m_table.compare_exchange_strong(table, built, std::memory_order_acq_rel, std::memory_order_acquire))
            table = built;
        else
            delete built;
    }
    if (table->length != characters.size()) [[unlikely]]
        return false;

    size_t end = std::min<size_t>(offset, characters.size());
    size_t block = end >> blockShift;
    Checkpoint state = table->checkpoints[block];
    scan(characters, block << blockShift, end, table->hasCarriageReturn, state);

    line = state.line;
    column = offset > state.lineStart ? offset - state.lineStart : 0;
    return true;
}

// (text: Uint8Array, offsets: Uint32Array) -> Uint32Array with a zero-based line and column for each offset.
BUN_DEFINE_HOST_FUNCTION(Bun__lineIndexForTesting, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* textView = dynamicDowncast<JSC::JSUint8Array>(callFrame->argument(0));
    auto* offsetsView = dynamicDowncast<JSC::JSUint32Array>(callFrame->argument(1));
    if (!textView || textView->isDetached() || !offsetsView || offsetsView->isDetached()) {
        throwTypeError(globalObject, scope, "expected (text: Uint8Array, offsets: Uint32Array)"_s);
        return {};
    }

    size_t count = offsetsView->length();
    auto* result = JSC::JSUint32Array::createUninitialized(globalObject, globalObject->typedArrayStructureWithTypedArrayType<JSC::TypeUint32>(), count * 2);
    RETURN_IF_EXCEPTION(scope, {});

    WTF::StringView text { std::span<const Latin1Character> { textView->typedVector(), textView->length() } };
    const uint32_t* offsets = offsetsView->typedVector();
    uint32_t* positions = result->typedVector();

    LineIndex index;
    for (size_t i = 0; i < count; i++) {
        unsigned line = 0;
        unsigned column = 0;
        bool found = index.lineAndColumn(text, offsets[i], line, column);
        RELEASE_ASSERT(found);
        positions[i * 2] = line;
        positions[i * 2 + 1] = column;
    }
    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(result));
}

// (fn: Function) -> boolean. True when JSC built its table of every line for the source of the function.
BUN_DEFINE_HOST_FUNCTION(Bun__lineStartTableIsBuiltForTesting, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* function = dynamicDowncast<JSC::JSFunction>(callFrame->argument(0));
    JSC::SourceProvider* provider = function && !function->isHostFunction() ? function->jsExecutable()->source().provider() : nullptr;
    if (!provider) {
        throwTypeError(globalObject, scope, "expected a function that has a source"_s);
        return {};
    }
    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(JSC::jsBoolean(provider->lineStartTableIsBuilt())));
}

} // namespace Bun
