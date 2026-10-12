#pragma once

#include "root.h"

#include <JavaScriptCore/Identifier.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/WriteBarrier.h>

namespace Bun {

class LintHost;

// What `context.report()` needs. A member of LintHost.
struct LintReportState {
    void finishCreation(JSC::VM&, JSC::JSGlobalObject*, LintHost*);
    void endFile() { reports.clear(); }

    template<typename Visitor>
    void visit(Visitor& visitor)
    {
        visitor.append(ruleStructure);
        visitor.append(fixStructure);
        visitor.append(target);
        visitor.append(name);
        visitor.append(fixer);
        visitor.append(reports);
    }

    // Property names that plugins and rules use.
    JSC::Identifier node, loc, messageId, data, fix, suggest, desc, range, text, start, end, line, column;
    JSC::Identifier messages, fixable, hasSuggestions, docs, suggestion, includes, replace;
    JSC::Identifier insertTextAfterRange, insertTextBeforeRange, replaceTextRange, removeRange;

    // `{ position, meta, report }`: what `report` is bound to.
    JSC::WriteBarrier<JSC::Structure> ruleStructure;
    // `{ range, text }`
    JSC::WriteBarrier<JSC::Structure> fixStructure;
    // The function behind every `context.report`, and its name.
    JSC::WriteBarrier<JSC::JSObject> target;
    JSC::WriteBarrier<JSC::JSString> name;
    // Made the first time a rule has a `fix`.
    JSC::WriteBarrier<JSC::JSObject> fixer;

    // The reports about the current file. Empty until there's one.
    JSC::WriteBarrier<JSC::JSArray> reports;
};

// Adds `reporter` and `takeReports` to the `native` object of the program in src/lint/js_plugin/worker.
void addLintReportFunctions(JSC::JSGlobalObject*, JSC::JSObject* native);

} // namespace Bun
