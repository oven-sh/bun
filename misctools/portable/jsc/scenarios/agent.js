// Scenario 6: threads inside jsc. The shell has $.agent (the test262 agent API): every agent is a
// thread with its own VM. Four agents get one SharedArrayBuffer, each of them computes, stores
// its result with Atomics and reports. The main thread sleeps in Atomics.wait until all are done.
var agents = 4;
var sab = new SharedArrayBuffer(4 * (agents + 2));
var ia = new Int32Array(sab);
for (var a = 0; a < agents; a++)
    $.agent.start(
        "var me = " + a + ";" +
        "$.agent.receiveBroadcast(function (sab) {" +
        "  var ia = new Int32Array(sab); var s = 0;" +
        "  for (var i = 0; i < 2e6; i++) s = (s + (i % (7 + me))) | 0;" +
        "  var junk = []; for (var i = 0; i < 50000; i++) junk.push({ i: i, t: 't' + i });" +
        "  Atomics.store(ia, 2 + me, s + junk.length);" +
        "  Atomics.add(ia, 0, 1); Atomics.notify(ia, 0);" +
        "  $.agent.report('agent ' + me + ' ' + (s + junk.length));" +
        "  $.agent.leaving();" +
        "});");
$.agent.broadcast(sab);
var waits = 0;
while (Atomics.load(ia, 0) < agents) {
    Atomics.wait(ia, 0, Atomics.load(ia, 0), 50);
    waits++;
}
var reports = [];
for (var a = 0; a < agents; a++)
    reports.push(waitForReport());
reports.sort();
for (var r of reports)
    print(r);
var values = [];
for (var a = 0; a < agents; a++)
    values.push(Atomics.load(ia, 2 + a));
print("agents done " + Atomics.load(ia, 0) + " values " + values.join(","));
