// RUN: lower
// OPTIONS: builtin-modules

// Every member of Bun comes into unknown hands through a global, and text that is evaluated at run time counts them.
globalThis[process.argv[5] ?? "nothing"] = JSON.parse(process.argv[6] ?? "0");
const members = [];
for (const key of Object.keys(Bun)) members.push(Bun[key]);
globalThis.members = members;
console.log(new Function("return members.length > 10")());
// The child may exit before or after its output has been read, so the exit code is printed behind the output.
const exited = Promise.withResolvers();
const child = Bun.spawn((process.platform === "win32" ? ["cmd", "/c", "echo hello from the child"] : ["/bin/echo", "hello from the child"]), { stdio: ["ignore", "pipe", "pipe"], onExit(_child, exitCode) { exited.resolve(exitCode); } });
console.log((await new Response(child.stdout).text()).trim());
console.log("exit", await exited.promise);

// GENERATED: onExit
// CHECK-LABEL: function {{*}}name="onExit"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[IsExpected]}, {type=null|number flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]], v1: null|number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="exited"
// CHECK-NEXT: v4 = PropGet v3 key="resolve"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: v6 = Call v5, v3, v1 calleeKey="resolve" calleeName="exited.resolve"
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
