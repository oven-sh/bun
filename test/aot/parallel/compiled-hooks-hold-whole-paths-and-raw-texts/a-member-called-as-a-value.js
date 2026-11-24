// Flags: --react-compiler --define=PATH=holder.o.m
// Reference: bun build --compile
// A member that the source calls as a value gets no receiver.
function kind() { "use strict"; return typeof this; }
function useMethod(props) { "use memo"; return props.o.m(); }
function useValue(props) { "use memo"; return (0, props.o.m)(); }
function useTag(props) { "use memo"; return (0, props.o.m)``; }
function useOptional(props) { "use memo"; return (0, props.o.m)?.(); }
function useAbsent(props) { "use memo"; return (0, props.o.absent)?.(); }
function useResult(props) { "use memo"; return (() => props.o.m)()(); }
function usePath() { "use memo"; return [PATH(), (0, PATH)(), (true && PATH)``]; }
const props = (globalThis.holder = { o: { m: kind } });
const hooks = [useMethod, useValue, useTag, useOptional, useAbsent, useResult, usePath];
const seen = hooks.map(hook => String(hook(props))).join();
console.log(seen);
if (seen !== "object,undefined,undefined,undefined,undefined,undefined,object,undefined,undefined") process.exit(1);
