// The profiler and the coverage start, stop and hand over what they gathered: only the kinds are printed.
import inspector from "node:inspector";
const session = new inspector.Session();
session.connect();
const post = (method, params) =>
  new Promise(done => session.post(method, params, (error, result) => done(error ? "refused: " + error.code : result)));
console.log(typeof (await post("Profiler.enable")), typeof (await post("Profiler.start")));
const stopped = await post("Profiler.stop");
console.log(typeof stopped, typeof stopped.profile, Array.isArray(stopped.profile.nodes), typeof stopped.profile.startTime);
console.log(typeof (await post("Profiler.startPreciseCoverage", { callCount: true, detailed: true })));
const taken = await post("Profiler.takePreciseCoverage");
console.log(typeof taken, Array.isArray(taken.result), typeof (await post("Profiler.stopPreciseCoverage")));
console.log(typeof (await post("Profiler.disable")));
session.disconnect();
console.log(inspector.url(), inspector.close());
try { inspector.waitForDebugger(); } catch (error) { console.log(error.code); }
