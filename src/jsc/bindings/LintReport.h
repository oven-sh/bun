#pragma once

#include "root.h"

#include <JavaScriptCore/Identifier.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/WriteBarrier.h>
#include <array>
#include <wtf/Vector.h>

namespace Bun {

class LintHost;

// What `context.report()` needs. A member of LintHost.
struct LintReportState {
    void finishCreation(JSC::VM&, JSC::JSGlobalObject*, LintHost*);
    void endFile() { bytes.shrink(0); }

    template<typename Visitor>
    void visit(Visitor& visitor)
    {
        visitor.append(ruleStructure);
        visitor.append(fixStructure);
        visitor.append(target);
        visitor.append(reportName);
        visitor.append(fixer);
        visitor.append(plainObjectPrototype);
        for (auto& shape : shapes)
            visitor.append(shape.structure);
    }

    // The properties of the argument of `report`.
    enum class Field : uint8_t {
        Node,
        Loc,
        MessageId,
        Message,
        Suggest,
        Fix,
        Data,
    };
    static constexpr size_t fieldCount = 7;
    std::array<JSC::Identifier, fieldCount> fieldNames;
    const JSC::Identifier& name(Field field) const { return fieldNames[static_cast<size_t>(field)]; }

    // Where these are in the objects of a Structure, so that reading them is no lookup by name. `invalidOffset`: there's none.
    struct Shape {
        JSC::WriteBarrier<JSC::Structure> structure;
        std::array<JSC::PropertyOffset, fieldCount> offsets;
    };
    std::array<Shape, 32> shapes;
    // Null: an object with this Structure has to be asked property by property.
    const Shape* shapeOf(JSC::JSGlobalObject*, LintHost*, JSC::Structure*);

    // The Structure that `Object.prototype` had when it was seen to have none of these properties and not to be iterable.
    JSC::WriteBarrier<JSC::Structure> plainObjectPrototype;
    bool isObjectPrototypePlain(JSC::JSGlobalObject* globalObject) const { return globalObject->objectPrototype()->structure() == plainObjectPrototype.get(); }
    bool checkObjectPrototype(JSC::JSGlobalObject*, LintHost*);

    // Other property names that plugins and rules use.
    JSC::Identifier messageId, data, fix, desc, range, text, start, end, line, column;
    JSC::Identifier messages, fixable, hasSuggestions, docs, suggestion, includes;
    JSC::Identifier insertTextAfterRange, insertTextBeforeRange, replaceTextRange, removeRange;

    // `{ position, meta, report }`: what `report` is bound to.
    JSC::WriteBarrier<JSC::Structure> ruleStructure;
    // `{ range, text }`
    JSC::WriteBarrier<JSC::Structure> fixStructure;
    // The function behind every `context.report`, and its name.
    JSC::WriteBarrier<JSC::JSObject> target;
    JSC::WriteBarrier<JSC::JSString> reportName;
    // Made the first time a rule has a `fix`.
    JSC::WriteBarrier<JSC::JSObject> fixer;

    // The reports about the current file that Rust hasn't been given yet: see src/lint/js_plugin/reports.rs.
    WTF::Vector<uint8_t> bytes;
};

// Adds `reporter` and `sendReports` to the `native` object of the program in src/lint/js_plugin/worker.
void addLintReportFunctions(JSC::JSGlobalObject*, JSC::JSObject* native);

} // namespace Bun
