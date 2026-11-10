// RUN: lower
// OPTIONS: builtin-modules

// Optional chains and ?? over links that end in null or undefined.
interface Link {
  value?: number;
  next?: Link | null;
  method?(): number;
  items?: number[];
}
const chain: Link = { value: 1, next: { value: 2, method: () => 7, items: [9] } };
console.log(chain.next?.value, chain.next?.next?.value, chain.next?.next?.next!.value);
console.log(chain.method?.(), chain.next?.method?.(), chain.next?.items?.[0], chain.items?.[0]);
console.log(chain.next?.next ?? "none", chain.value ?? "unused", (chain.next?.next)?.value);
let calls = 0;
const side = () => ++calls;
chain.items?.[side()];
console.log(calls, delete chain.next?.next?.value);
let maybe: number | null = null;
maybe ??= 5;
maybe ||= 6;
maybe &&= 7;
console.log(maybe);

// GENERATED: method side
// CHECK-LABEL: function {{*}}name="method"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Integer integer=7
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="side"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="calls"
// CHECK-NEXT: v2 = Increment v1
// CHECK-NEXT: v3 = Convert v2 declared={type=number}
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v5 = CheckInitialized v4 name="calls"
// CHECK-NEXT: PutModuleVariable v3 variable=[[g_1]]
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
