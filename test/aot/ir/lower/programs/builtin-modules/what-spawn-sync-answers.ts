// RUN: lower
// OPTIONS: builtin-modules

// What Bun.spawnSync answers, each member used as what it is: for output that is collected, ignored, inherited or sent to a descriptor, for a signal, a timeout and a limit.
import { openSync, closeSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
const say = (...values: unknown[]) => console.log(...values);
const printed = Bun.spawnSync(["echo", "printed"]);
say(printed.stdout.toString().trim(), printed.stdout.length, printed.stdout instanceof Buffer, (printed.stdout.constructor as typeof Buffer).from("abc").length, (printed.stdout.constructor as typeof Buffer).isBuffer(printed.stdout));
say(printed.stderr.length, printed.exitCode + 1, printed.success, printed.signalCode, "signalCode" in printed, typeof printed.pid, printed.pid > 0, Object.keys(printed).join());
say(typeof printed.resourceUsage!.maxRSS, typeof printed.resourceUsage!.cpuTime.user, Object.getPrototypeOf(printed) === Object.prototype, JSON.stringify(printed.stdout.toJSON().data.slice(0, 2)));
const ignored = Bun.spawnSync({ cmd: ["echo", "ignored"], stdout: "ignore", stderr: "inherit" });
say(ignored.stdout, ignored.stderr, ignored.exitCode);
const path = `${tmpdir()}/spawn-sync-output-${process.pid}.txt`;
const descriptor = openSync(path, "w");
const sent = Bun.spawnSync(["echo", "to a descriptor"], { stdout: descriptor });
closeSync(descriptor);
say(typeof sent.stdout, (sent.stdout as unknown as number) === descriptor, readFileSync(path, "utf8").trim());
unlinkSync(path);
const failed = Bun.spawnSync(["sh", "-c", "echo oops >&2; exit 3"]);
say(failed.exitCode, failed.success, failed.stderr.toString().trim(), failed.stdout.length);
const killed = Bun.spawnSync(["sh", "-c", "kill -TERM $$"]);
say(killed.exitCode, killed.signalCode, killed.success);
const late = Bun.spawnSync(["sleep", "5"], { timeout: 50 });
say(late.exitedDueToTimeout, late.signalCode, late.exitCode, "exitedDueToMaxBuffer" in late);
const limited = Bun.spawnSync(["sh", "-c", "yes | head -c 100000"], { maxBuffer: 10 });
say(limited.exitedDueToMaxBuffer, "exitedDueToTimeout" in limited, typeof limited.stdout);
try { Bun.spawnSync(["/does/not/exist"]); } catch (e) { say((e as any).code, (e as Error).name); }

// GENERATED: say
// CHECK-LABEL: function {{*}}name="say"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[HasRestParameter, IsChecked] thisType={type=anything} parameters=[{type=Array site=[[w_1]] flags=[IsFromCompiler, OmitsNull, OmitsUndefined]}] results=[{type=anything}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="console" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="log"
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v6 = NewArray contents=anything
// CHECK-NEXT: AppendSpread v6, v0
// CHECK-NEXT: v8 = CallList v5, v3, v6 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: ReturnCall v8
// CHECK-NEXT: }
