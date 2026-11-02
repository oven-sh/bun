// "%j" prints a bigint through the toJSON that BigInt.prototype was given. A variable, a field and an element that the function changes are read before each call and again behind it.
let calls = 0;
const holder = { calls: 0 };
const list = [0];
(BigInt.prototype as any).toJSON = () => {
  calls++;
  holder.calls++;
  list[0]++;
  return "big";
};

const before = calls;
console.log("%j", 1n);
console.log(before, calls);

function log() {
  const variable = calls,
    field = holder.calls,
    element = list[0];
  console.log("%j", 2n);
  return [variable, field, element, calls, holder.calls, list[0]].join();
}
function info() {
  const variable = calls,
    field = holder.calls,
    element = list[0];
  console.info("%j", 3n);
  return [variable, field, element, calls, holder.calls, list[0]].join();
}
function debug() {
  const variable = calls,
    field = holder.calls,
    element = list[0];
  console.debug("%j", 4n);
  return [variable, field, element, calls, holder.calls, list[0]].join();
}
function warn() {
  const variable = calls,
    field = holder.calls,
    element = list[0];
  console.warn("%j", 5n);
  return [variable, field, element, calls, holder.calls, list[0]].join();
}
function error() {
  const variable = calls,
    field = holder.calls,
    element = list[0];
  console.error("%j", 6n);
  return [variable, field, element, calls, holder.calls, list[0]].join();
}
function dirxml() {
  const variable = calls,
    field = holder.calls,
    element = list[0];
  console.dirxml("%j", 7n);
  return [variable, field, element, calls, holder.calls, list[0]].join();
}
function assert() {
  const variable = calls,
    field = holder.calls,
    element = list[0];
  console.assert(false, "%j", 8n);
  return [variable, field, element, calls, holder.calls, list[0]].join();
}
function group() {
  const variable = calls,
    field = holder.calls,
    element = list[0];
  console.group("%j", 9n);
  console.groupEnd();
  return [variable, field, element, calls, holder.calls, list[0]].join();
}
function groupCollapsed() {
  const variable = calls,
    field = holder.calls,
    element = list[0];
  console.groupCollapsed("%j", 10n);
  console.groupEnd();
  return [variable, field, element, calls, holder.calls, list[0]].join();
}
function behindOtherDirectives(big: bigint) {
  const variable = calls,
    field = holder.calls,
    element = list[0];
  console.log("%s %d %j", "text", 1.5, big);
  return [variable, field, element, calls, holder.calls, list[0]].join();
}
function withoutTheDirective() {
  const variable = calls,
    field = holder.calls,
    element = list[0];
  console.log("%s", 11n, 12n);
  console.dir(13n);
  console.table(14n);
  return [variable, field, element, calls, holder.calls, list[0]].join();
}

for (const each of [log, info, debug, warn, error, dirxml, assert, group, groupCollapsed, withoutTheDirective])
  console.log(each.name, each());
console.log(behindOtherDirectives(15n));
