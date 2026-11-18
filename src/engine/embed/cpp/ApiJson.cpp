#include "engine/Engine.h"

namespace JSC {

static void appendValues(void* values, const EncodedJSValue* first, size_t count)
{
    auto& list = *static_cast<MarkedArgumentBuffer*>(values);
    list.ensureCapacity(list.size() + count);
    for (EncodedJSValue value : std::span(first, count))
        list.append(JSValue::decode(value));
}

template<typename Parse> static StreamingJSONParseResult parseLines(JSGlobalObject* globalObject, MarkedArgumentBuffer& values, const Parse& parse)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    StreamingJSONParseResult result;
    result.status = static_cast<StreamingJSONParseResult::Status>(parse(result.charactersConsumed));
    RETURN_IF_EXCEPTION(scope, {});
    if (values.hasOverflowed()) [[unlikely]]
        throwOutOfMemoryError(globalObject, scope);
    return result;
}

StreamingJSONParseResult streamingJSONParse(JSGlobalObject* globalObject, StringView text, MarkedArgumentBuffer& values)
{
    return parseLines(globalObject, values, [&](size_t& read) { return Engine::json_parse_lines(globalObject, text, read, appendValues, &values); });
}

StreamingJSONParseResult streamingJSONParse(JSGlobalObject* globalObject, std::span<const char8_t> utf8, MarkedArgumentBuffer& values)
{
    return parseLines(globalObject, values, [&](size_t& read) { return Engine::json_parse_lines_utf8(globalObject, byteCast<uint8_t>(utf8), read, appendValues, &values); });
}

} // namespace JSC
