import events, { EventEmitter, once } from "node:events";
import util, { format, inspect } from "node:util";
import path, { join, basename } from "node:path";
const before = [EventEmitter, once, format, inspect, join, basename];
events.EventEmitter = function Fake() {};
events.once = () => "fake";
util.format = () => "fake";
util.inspect = () => "fake";
path.join = () => "fake";
path.basename = () => "fake";
function use(i) { return [new EventEmitter() instanceof before[0], typeof once, format("%d-%s", i, "x"), inspect({ i }), join("a", "b" + i), basename("/x/y" + i)].join("|"); }
for (let i = 0; i < 3; i++) console.log(use(i), util.format("%d", i), path.join("a", "b"), [EventEmitter, once, format, inspect, join, basename].every((one, at) => one === before[at]));
