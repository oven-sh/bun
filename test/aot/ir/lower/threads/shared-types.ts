// RUN(ONE): link
// OPTIONS(ONE): threads=1
// RUN(T2A): link
// OPTIONS(T2A): threads=2
// SAME: ONE T2A
// RUN(T8A): link
// OPTIONS(T8A): threads=8
// SAME: ONE T8A
// RUN(T8B): link
// OPTIONS(T8B): threads=8
// SAME: ONE T8B
// RUN(T16A): link
// OPTIONS(T16A): threads=16
// SAME: ONE T16A

// Many files say the same of the types that they share, and the link keeps what the first of them says. The program does not depend on which thread gets where first.

// FILE: main.ts
import { run0 } from "./module0.ts";
declare const console: { log(...values: unknown[]): void };
console.log(run0(1));

// FILE: tsconfig.json
{"compilerOptions":{"strict":true,"target":"esnext","module":"esnext","moduleResolution":"bundler","allowImportingTsExtensions":true,"noEmit":true,"types":[]}}

// FILE: types0.ts
export interface Shared0 {
  id: number;
  name: string;
  field0?: number;
  field1: string;
  field2: string[];
  field3?: () => number;
  field4: Map<string, number>;
  field5: number;
  field6?: string;
  field7: string[];
  field8: () => number;
  field9?: Map<string, number>;
  field10: number;
  field11: string;
  next?: Shared0;
}
export interface First0 { kind: "first"; value: number; owner?: Shared0 }
export interface Second0 { kind: "second"; text: string; call(x: number): string }
export type Kind0 = First0 | Second0;
export interface Box0<T> { value: T; items: T[]; owner?: Shared0 }

// FILE: types1.ts
import type { Shared0, Kind0 } from "./types0.ts";
export interface Shared1 {
  id: number;
  name: string;
  field0?: number;
  field1: string;
  field2: string[];
  field3?: () => number;
  field4: Map<string, number>;
  field5: number;
  field6?: string;
  field7: string[];
  field8: () => number;
  field9?: Map<string, number>;
  field10: number;
  field11: string;
  earlier?: Shared0;
  kinds: Kind0[];
  next?: Shared1;
}
export interface First1 { kind: "first"; value: number; owner?: Shared1 }
export interface Second1 { kind: "second"; text: string; call(x: number): string }
export type Kind1 = First1 | Second1;
export interface Box1<T> { value: T; items: T[]; owner?: Shared1 }

// FILE: types2.ts
import type { Shared1, Kind1 } from "./types1.ts";
export interface Shared2 {
  id: number;
  name: string;
  field0?: number;
  field1: string;
  field2: string[];
  field3?: () => number;
  field4: Map<string, number>;
  field5: number;
  field6?: string;
  field7: string[];
  field8: () => number;
  field9?: Map<string, number>;
  field10: number;
  field11: string;
  earlier?: Shared1;
  kinds: Kind1[];
  next?: Shared2;
}
export interface First2 { kind: "first"; value: number; owner?: Shared2 }
export interface Second2 { kind: "second"; text: string; call(x: number): string }
export type Kind2 = First2 | Second2;
export interface Box2<T> { value: T; items: T[]; owner?: Shared2 }

// FILE: types3.ts
import type { Shared2, Kind2 } from "./types2.ts";
export interface Shared3 {
  id: number;
  name: string;
  field0?: number;
  field1: string;
  field2: string[];
  field3?: () => number;
  field4: Map<string, number>;
  field5: number;
  field6?: string;
  field7: string[];
  field8: () => number;
  field9?: Map<string, number>;
  field10: number;
  field11: string;
  earlier?: Shared2;
  kinds: Kind2[];
  next?: Shared3;
}
export interface First3 { kind: "first"; value: number; owner?: Shared3 }
export interface Second3 { kind: "second"; text: string; call(x: number): string }
export type Kind3 = First3 | Second3;
export interface Box3<T> { value: T; items: T[]; owner?: Shared3 }

// FILE: types4.ts
import type { Shared3, Kind3 } from "./types3.ts";
export interface Shared4 {
  id: number;
  name: string;
  field0?: number;
  field1: string;
  field2: string[];
  field3?: () => number;
  field4: Map<string, number>;
  field5: number;
  field6?: string;
  field7: string[];
  field8: () => number;
  field9?: Map<string, number>;
  field10: number;
  field11: string;
  earlier?: Shared3;
  kinds: Kind3[];
  next?: Shared4;
}
export interface First4 { kind: "first"; value: number; owner?: Shared4 }
export interface Second4 { kind: "second"; text: string; call(x: number): string }
export type Kind4 = First4 | Second4;
export interface Box4<T> { value: T; items: T[]; owner?: Shared4 }

// FILE: types5.ts
import type { Shared4, Kind4 } from "./types4.ts";
export interface Shared5 {
  id: number;
  name: string;
  field0?: number;
  field1: string;
  field2: string[];
  field3?: () => number;
  field4: Map<string, number>;
  field5: number;
  field6?: string;
  field7: string[];
  field8: () => number;
  field9?: Map<string, number>;
  field10: number;
  field11: string;
  earlier?: Shared4;
  kinds: Kind4[];
  next?: Shared5;
}
export interface First5 { kind: "first"; value: number; owner?: Shared5 }
export interface Second5 { kind: "second"; text: string; call(x: number): string }
export type Kind5 = First5 | Second5;
export interface Box5<T> { value: T; items: T[]; owner?: Shared5 }

// FILE: module0.ts
import type { Shared0, Kind0, Box0 } from "./types0.ts";
import type { Shared1, Kind1, Box1 } from "./types1.ts";
import { run1 } from "./module1.ts";
import { run2 } from "./module2.ts";
function read0(shared: Shared0, kind: Kind0, box: Box0<number>, texts: Box0<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field0 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
function read1(shared: Shared1, kind: Kind1, box: Box1<number>, texts: Box1<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field0 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
export function run0(seed: number): number {
  const readers = [read0, read1];
  const local = { seed, label: "module 0", nested: { depth: 0 } };
  return readers.length + local.nested.depth + local.label.length + run1(seed + 1) + run2(seed + 1);
}

// FILE: module1.ts
import type { Shared1, Kind1, Box1 } from "./types1.ts";
import type { Shared0, Kind0, Box0 } from "./types0.ts";
import { run3 } from "./module3.ts";
import { run4 } from "./module4.ts";
function read1(shared: Shared1, kind: Kind1, box: Box1<number>, texts: Box1<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field1 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
function read0(shared: Shared0, kind: Kind0, box: Box0<number>, texts: Box0<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field1 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
export function run1(seed: number): number {
  const readers = [read1, read0];
  const local = { seed, label: "module 1", nested: { depth: 1 } };
  return readers.length + local.nested.depth + local.label.length + run3(seed + 1) + run4(seed + 1);
}

// FILE: module2.ts
import type { Shared2, Kind2, Box2 } from "./types2.ts";
import type { Shared5, Kind5, Box5 } from "./types5.ts";
import { run5 } from "./module5.ts";
import { run6 } from "./module6.ts";
function read2(shared: Shared2, kind: Kind2, box: Box2<number>, texts: Box2<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field2 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
function read5(shared: Shared5, kind: Kind5, box: Box5<number>, texts: Box5<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field2 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
export function run2(seed: number): number {
  const readers = [read2, read5];
  const local = { seed, label: "module 2", nested: { depth: 2 } };
  return readers.length + local.nested.depth + local.label.length + run5(seed + 1) + run6(seed + 1);
}

// FILE: module3.ts
import type { Shared3, Kind3, Box3 } from "./types3.ts";
import type { Shared4, Kind4, Box4 } from "./types4.ts";
import { run7 } from "./module7.ts";
import { run8 } from "./module8.ts";
function read3(shared: Shared3, kind: Kind3, box: Box3<number>, texts: Box3<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field3 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
function read4(shared: Shared4, kind: Kind4, box: Box4<number>, texts: Box4<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field3 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
export function run3(seed: number): number {
  const readers = [read3, read4];
  const local = { seed, label: "module 3", nested: { depth: 3 } };
  return readers.length + local.nested.depth + local.label.length + run7(seed + 1) + run8(seed + 1);
}

// FILE: module4.ts
import type { Shared4, Kind4, Box4 } from "./types4.ts";
import type { Shared3, Kind3, Box3 } from "./types3.ts";
import { run9 } from "./module9.ts";
import { run10 } from "./module10.ts";
function read4(shared: Shared4, kind: Kind4, box: Box4<number>, texts: Box4<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field4 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
function read3(shared: Shared3, kind: Kind3, box: Box3<number>, texts: Box3<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field4 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
export function run4(seed: number): number {
  const readers = [read4, read3];
  const local = { seed, label: "module 4", nested: { depth: 4 } };
  return readers.length + local.nested.depth + local.label.length + run9(seed + 1) + run10(seed + 1);
}

// FILE: module5.ts
import type { Shared5, Kind5, Box5 } from "./types5.ts";
import type { Shared2, Kind2, Box2 } from "./types2.ts";
import { run11 } from "./module11.ts";
import { run12 } from "./module12.ts";
function read5(shared: Shared5, kind: Kind5, box: Box5<number>, texts: Box5<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field5 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
function read2(shared: Shared2, kind: Kind2, box: Box2<number>, texts: Box2<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field5 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
export function run5(seed: number): number {
  const readers = [read5, read2];
  const local = { seed, label: "module 5", nested: { depth: 5 } };
  return readers.length + local.nested.depth + local.label.length + run11(seed + 1) + run12(seed + 1);
}

// FILE: module6.ts
import type { Shared0, Kind0, Box0 } from "./types0.ts";
import type { Shared1, Kind1, Box1 } from "./types1.ts";
import { run13 } from "./module13.ts";
import { run14 } from "./module14.ts";
function read0(shared: Shared0, kind: Kind0, box: Box0<number>, texts: Box0<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field6 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
function read1(shared: Shared1, kind: Kind1, box: Box1<number>, texts: Box1<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field6 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
export function run6(seed: number): number {
  const readers = [read0, read1];
  const local = { seed, label: "module 6", nested: { depth: 6 } };
  return readers.length + local.nested.depth + local.label.length + run13(seed + 1) + run14(seed + 1);
}

// FILE: module7.ts
import type { Shared1, Kind1, Box1 } from "./types1.ts";
import type { Shared0, Kind0, Box0 } from "./types0.ts";
import { run15 } from "./module15.ts";
import { run16 } from "./module16.ts";
function read1(shared: Shared1, kind: Kind1, box: Box1<number>, texts: Box1<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field7 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
function read0(shared: Shared0, kind: Kind0, box: Box0<number>, texts: Box0<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field7 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
export function run7(seed: number): number {
  const readers = [read1, read0];
  const local = { seed, label: "module 7", nested: { depth: 7 } };
  return readers.length + local.nested.depth + local.label.length + run15(seed + 1) + run16(seed + 1);
}

// FILE: module8.ts
import type { Shared2, Kind2, Box2 } from "./types2.ts";
import type { Shared5, Kind5, Box5 } from "./types5.ts";
import { run17 } from "./module17.ts";
import { run18 } from "./module18.ts";
function read2(shared: Shared2, kind: Kind2, box: Box2<number>, texts: Box2<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field8 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
function read5(shared: Shared5, kind: Kind5, box: Box5<number>, texts: Box5<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field8 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
export function run8(seed: number): number {
  const readers = [read2, read5];
  const local = { seed, label: "module 8", nested: { depth: 8 } };
  return readers.length + local.nested.depth + local.label.length + run17(seed + 1) + run18(seed + 1);
}

// FILE: module9.ts
import type { Shared3, Kind3, Box3 } from "./types3.ts";
import type { Shared4, Kind4, Box4 } from "./types4.ts";
import { run19 } from "./module19.ts";
import { run20 } from "./module20.ts";
function read3(shared: Shared3, kind: Kind3, box: Box3<number>, texts: Box3<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field9 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
function read4(shared: Shared4, kind: Kind4, box: Box4<number>, texts: Box4<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field9 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
export function run9(seed: number): number {
  const readers = [read3, read4];
  const local = { seed, label: "module 9", nested: { depth: 9 } };
  return readers.length + local.nested.depth + local.label.length + run19(seed + 1) + run20(seed + 1);
}

// FILE: module10.ts
import type { Shared4, Kind4, Box4 } from "./types4.ts";
import type { Shared3, Kind3, Box3 } from "./types3.ts";
import { run21 } from "./module21.ts";
import { run22 } from "./module22.ts";
function read4(shared: Shared4, kind: Kind4, box: Box4<number>, texts: Box4<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field10 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
function read3(shared: Shared3, kind: Kind3, box: Box3<number>, texts: Box3<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field10 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
export function run10(seed: number): number {
  const readers = [read4, read3];
  const local = { seed, label: "module 10", nested: { depth: 10 } };
  return readers.length + local.nested.depth + local.label.length + run21(seed + 1) + run22(seed + 1);
}

// FILE: module11.ts
import type { Shared5, Kind5, Box5 } from "./types5.ts";
import type { Shared2, Kind2, Box2 } from "./types2.ts";
import { run23 } from "./module23.ts";
import { run24 } from "./module24.ts";
function read5(shared: Shared5, kind: Kind5, box: Box5<number>, texts: Box5<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field11 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
function read2(shared: Shared2, kind: Kind2, box: Box2<number>, texts: Box2<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field11 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
export function run11(seed: number): number {
  const readers = [read5, read2];
  const local = { seed, label: "module 11", nested: { depth: 11 } };
  return readers.length + local.nested.depth + local.label.length + run23(seed + 1) + run24(seed + 1);
}

// FILE: module12.ts
import type { Shared0, Kind0, Box0 } from "./types0.ts";
import type { Shared1, Kind1, Box1 } from "./types1.ts";
import { run25 } from "./module25.ts";
import { run26 } from "./module26.ts";
function read0(shared: Shared0, kind: Kind0, box: Box0<number>, texts: Box0<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field0 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
function read1(shared: Shared1, kind: Kind1, box: Box1<number>, texts: Box1<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field0 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
export function run12(seed: number): number {
  const readers = [read0, read1];
  const local = { seed, label: "module 12", nested: { depth: 12 } };
  return readers.length + local.nested.depth + local.label.length + run25(seed + 1) + run26(seed + 1);
}

// FILE: module13.ts
import type { Shared1, Kind1, Box1 } from "./types1.ts";
import type { Shared0, Kind0, Box0 } from "./types0.ts";
import { run27 } from "./module27.ts";
import { run28 } from "./module28.ts";
function read1(shared: Shared1, kind: Kind1, box: Box1<number>, texts: Box1<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field1 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
function read0(shared: Shared0, kind: Kind0, box: Box0<number>, texts: Box0<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field1 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
export function run13(seed: number): number {
  const readers = [read1, read0];
  const local = { seed, label: "module 13", nested: { depth: 13 } };
  return readers.length + local.nested.depth + local.label.length + run27(seed + 1) + run28(seed + 1);
}

// FILE: module14.ts
import type { Shared2, Kind2, Box2 } from "./types2.ts";
import type { Shared5, Kind5, Box5 } from "./types5.ts";
import { run29 } from "./module29.ts";
import { run30 } from "./module30.ts";
function read2(shared: Shared2, kind: Kind2, box: Box2<number>, texts: Box2<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field2 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
function read5(shared: Shared5, kind: Kind5, box: Box5<number>, texts: Box5<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field2 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
export function run14(seed: number): number {
  const readers = [read2, read5];
  const local = { seed, label: "module 14", nested: { depth: 14 } };
  return readers.length + local.nested.depth + local.label.length + run29(seed + 1) + run30(seed + 1);
}

// FILE: module15.ts
import type { Shared3, Kind3, Box3 } from "./types3.ts";
import type { Shared4, Kind4, Box4 } from "./types4.ts";
import { run31 } from "./module31.ts";
import { run32 } from "./module32.ts";
function read3(shared: Shared3, kind: Kind3, box: Box3<number>, texts: Box3<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field3 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
function read4(shared: Shared4, kind: Kind4, box: Box4<number>, texts: Box4<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field3 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
export function run15(seed: number): number {
  const readers = [read3, read4];
  const local = { seed, label: "module 15", nested: { depth: 15 } };
  return readers.length + local.nested.depth + local.label.length + run31(seed + 1) + run32(seed + 1);
}

// FILE: module16.ts
import type { Shared4, Kind4, Box4 } from "./types4.ts";
import type { Shared3, Kind3, Box3 } from "./types3.ts";
import { run33 } from "./module33.ts";
import { run34 } from "./module34.ts";
function read4(shared: Shared4, kind: Kind4, box: Box4<number>, texts: Box4<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field4 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
function read3(shared: Shared3, kind: Kind3, box: Box3<number>, texts: Box3<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field4 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
export function run16(seed: number): number {
  const readers = [read4, read3];
  const local = { seed, label: "module 16", nested: { depth: 16 } };
  return readers.length + local.nested.depth + local.label.length + run33(seed + 1) + run34(seed + 1);
}

// FILE: module17.ts
import type { Shared5, Kind5, Box5 } from "./types5.ts";
import type { Shared2, Kind2, Box2 } from "./types2.ts";
import { run35 } from "./module35.ts";
import { run36 } from "./module36.ts";
function read5(shared: Shared5, kind: Kind5, box: Box5<number>, texts: Box5<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field5 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
function read2(shared: Shared2, kind: Kind2, box: Box2<number>, texts: Box2<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field5 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
export function run17(seed: number): number {
  const readers = [read5, read2];
  const local = { seed, label: "module 17", nested: { depth: 17 } };
  return readers.length + local.nested.depth + local.label.length + run35(seed + 1) + run36(seed + 1);
}

// FILE: module18.ts
import type { Shared0, Kind0, Box0 } from "./types0.ts";
import type { Shared1, Kind1, Box1 } from "./types1.ts";
import { run37 } from "./module37.ts";
import { run38 } from "./module38.ts";
function read0(shared: Shared0, kind: Kind0, box: Box0<number>, texts: Box0<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field6 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
function read1(shared: Shared1, kind: Kind1, box: Box1<number>, texts: Box1<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field6 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
export function run18(seed: number): number {
  const readers = [read0, read1];
  const local = { seed, label: "module 18", nested: { depth: 18 } };
  return readers.length + local.nested.depth + local.label.length + run37(seed + 1) + run38(seed + 1);
}

// FILE: module19.ts
import type { Shared1, Kind1, Box1 } from "./types1.ts";
import type { Shared0, Kind0, Box0 } from "./types0.ts";
import { run39 } from "./module39.ts";
import { run40 } from "./module40.ts";
function read1(shared: Shared1, kind: Kind1, box: Box1<number>, texts: Box1<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field7 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
function read0(shared: Shared0, kind: Kind0, box: Box0<number>, texts: Box0<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field7 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
export function run19(seed: number): number {
  const readers = [read1, read0];
  const local = { seed, label: "module 19", nested: { depth: 19 } };
  return readers.length + local.nested.depth + local.label.length + run39(seed + 1) + run40(seed + 1);
}

// FILE: module20.ts
import type { Shared2, Kind2, Box2 } from "./types2.ts";
import type { Shared5, Kind5, Box5 } from "./types5.ts";
import { run41 } from "./module41.ts";
import { run42 } from "./module42.ts";
function read2(shared: Shared2, kind: Kind2, box: Box2<number>, texts: Box2<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field8 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
function read5(shared: Shared5, kind: Kind5, box: Box5<number>, texts: Box5<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field8 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
export function run20(seed: number): number {
  const readers = [read2, read5];
  const local = { seed, label: "module 20", nested: { depth: 20 } };
  return readers.length + local.nested.depth + local.label.length + run41(seed + 1) + run42(seed + 1);
}

// FILE: module21.ts
import type { Shared3, Kind3, Box3 } from "./types3.ts";
import type { Shared4, Kind4, Box4 } from "./types4.ts";
import { run43 } from "./module43.ts";
import { run44 } from "./module44.ts";
function read3(shared: Shared3, kind: Kind3, box: Box3<number>, texts: Box3<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field9 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
function read4(shared: Shared4, kind: Kind4, box: Box4<number>, texts: Box4<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field9 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
export function run21(seed: number): number {
  const readers = [read3, read4];
  const local = { seed, label: "module 21", nested: { depth: 21 } };
  return readers.length + local.nested.depth + local.label.length + run43(seed + 1) + run44(seed + 1);
}

// FILE: module22.ts
import type { Shared4, Kind4, Box4 } from "./types4.ts";
import type { Shared3, Kind3, Box3 } from "./types3.ts";
import { run45 } from "./module45.ts";
import { run46 } from "./module46.ts";
function read4(shared: Shared4, kind: Kind4, box: Box4<number>, texts: Box4<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field10 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
function read3(shared: Shared3, kind: Kind3, box: Box3<number>, texts: Box3<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field10 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
export function run22(seed: number): number {
  const readers = [read4, read3];
  const local = { seed, label: "module 22", nested: { depth: 22 } };
  return readers.length + local.nested.depth + local.label.length + run45(seed + 1) + run46(seed + 1);
}

// FILE: module23.ts
import type { Shared5, Kind5, Box5 } from "./types5.ts";
import type { Shared2, Kind2, Box2 } from "./types2.ts";
import { run47 } from "./module47.ts";
function read5(shared: Shared5, kind: Kind5, box: Box5<number>, texts: Box5<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field11 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
function read2(shared: Shared2, kind: Kind2, box: Box2<number>, texts: Box2<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field11 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
export function run23(seed: number): number {
  const readers = [read5, read2];
  const local = { seed, label: "module 23", nested: { depth: 23 } };
  return readers.length + local.nested.depth + local.label.length + run47(seed + 1);
}

// FILE: module24.ts
import type { Shared0, Kind0, Box0 } from "./types0.ts";
import type { Shared1, Kind1, Box1 } from "./types1.ts";
function read0(shared: Shared0, kind: Kind0, box: Box0<number>, texts: Box0<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field0 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
function read1(shared: Shared1, kind: Kind1, box: Box1<number>, texts: Box1<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field0 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
export function run24(seed: number): number {
  const readers = [read0, read1];
  const local = { seed, label: "module 24", nested: { depth: 24 } };
  return readers.length + local.nested.depth + local.label.length;
}

// FILE: module25.ts
import type { Shared1, Kind1, Box1 } from "./types1.ts";
import type { Shared0, Kind0, Box0 } from "./types0.ts";
function read1(shared: Shared1, kind: Kind1, box: Box1<number>, texts: Box1<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field1 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
function read0(shared: Shared0, kind: Kind0, box: Box0<number>, texts: Box0<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field1 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
export function run25(seed: number): number {
  const readers = [read1, read0];
  const local = { seed, label: "module 25", nested: { depth: 25 } };
  return readers.length + local.nested.depth + local.label.length;
}

// FILE: module26.ts
import type { Shared2, Kind2, Box2 } from "./types2.ts";
import type { Shared5, Kind5, Box5 } from "./types5.ts";
function read2(shared: Shared2, kind: Kind2, box: Box2<number>, texts: Box2<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field2 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
function read5(shared: Shared5, kind: Kind5, box: Box5<number>, texts: Box5<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field2 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
export function run26(seed: number): number {
  const readers = [read2, read5];
  const local = { seed, label: "module 26", nested: { depth: 26 } };
  return readers.length + local.nested.depth + local.label.length;
}

// FILE: module27.ts
import type { Shared3, Kind3, Box3 } from "./types3.ts";
import type { Shared4, Kind4, Box4 } from "./types4.ts";
function read3(shared: Shared3, kind: Kind3, box: Box3<number>, texts: Box3<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field3 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
function read4(shared: Shared4, kind: Kind4, box: Box4<number>, texts: Box4<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field3 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
export function run27(seed: number): number {
  const readers = [read3, read4];
  const local = { seed, label: "module 27", nested: { depth: 27 } };
  return readers.length + local.nested.depth + local.label.length;
}

// FILE: module28.ts
import type { Shared4, Kind4, Box4 } from "./types4.ts";
import type { Shared3, Kind3, Box3 } from "./types3.ts";
function read4(shared: Shared4, kind: Kind4, box: Box4<number>, texts: Box4<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field4 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
function read3(shared: Shared3, kind: Kind3, box: Box3<number>, texts: Box3<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field4 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
export function run28(seed: number): number {
  const readers = [read4, read3];
  const local = { seed, label: "module 28", nested: { depth: 28 } };
  return readers.length + local.nested.depth + local.label.length;
}

// FILE: module29.ts
import type { Shared5, Kind5, Box5 } from "./types5.ts";
import type { Shared2, Kind2, Box2 } from "./types2.ts";
function read5(shared: Shared5, kind: Kind5, box: Box5<number>, texts: Box5<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field5 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
function read2(shared: Shared2, kind: Kind2, box: Box2<number>, texts: Box2<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field5 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
export function run29(seed: number): number {
  const readers = [read5, read2];
  const local = { seed, label: "module 29", nested: { depth: 29 } };
  return readers.length + local.nested.depth + local.label.length;
}

// FILE: module30.ts
import type { Shared0, Kind0, Box0 } from "./types0.ts";
import type { Shared1, Kind1, Box1 } from "./types1.ts";
function read0(shared: Shared0, kind: Kind0, box: Box0<number>, texts: Box0<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field6 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
function read1(shared: Shared1, kind: Kind1, box: Box1<number>, texts: Box1<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field6 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
export function run30(seed: number): number {
  const readers = [read0, read1];
  const local = { seed, label: "module 30", nested: { depth: 30 } };
  return readers.length + local.nested.depth + local.label.length;
}

// FILE: module31.ts
import type { Shared1, Kind1, Box1 } from "./types1.ts";
import type { Shared0, Kind0, Box0 } from "./types0.ts";
function read1(shared: Shared1, kind: Kind1, box: Box1<number>, texts: Box1<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field7 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
function read0(shared: Shared0, kind: Kind0, box: Box0<number>, texts: Box0<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field7 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
export function run31(seed: number): number {
  const readers = [read1, read0];
  const local = { seed, label: "module 31", nested: { depth: 31 } };
  return readers.length + local.nested.depth + local.label.length;
}

// FILE: module32.ts
import type { Shared2, Kind2, Box2 } from "./types2.ts";
import type { Shared5, Kind5, Box5 } from "./types5.ts";
function read2(shared: Shared2, kind: Kind2, box: Box2<number>, texts: Box2<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field8 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
function read5(shared: Shared5, kind: Kind5, box: Box5<number>, texts: Box5<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field8 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
export function run32(seed: number): number {
  const readers = [read2, read5];
  const local = { seed, label: "module 32", nested: { depth: 32 } };
  return readers.length + local.nested.depth + local.label.length;
}

// FILE: module33.ts
import type { Shared3, Kind3, Box3 } from "./types3.ts";
import type { Shared4, Kind4, Box4 } from "./types4.ts";
function read3(shared: Shared3, kind: Kind3, box: Box3<number>, texts: Box3<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field9 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
function read4(shared: Shared4, kind: Kind4, box: Box4<number>, texts: Box4<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field9 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
export function run33(seed: number): number {
  const readers = [read3, read4];
  const local = { seed, label: "module 33", nested: { depth: 33 } };
  return readers.length + local.nested.depth + local.label.length;
}

// FILE: module34.ts
import type { Shared4, Kind4, Box4 } from "./types4.ts";
import type { Shared3, Kind3, Box3 } from "./types3.ts";
function read4(shared: Shared4, kind: Kind4, box: Box4<number>, texts: Box4<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field10 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
function read3(shared: Shared3, kind: Kind3, box: Box3<number>, texts: Box3<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field10 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
export function run34(seed: number): number {
  const readers = [read4, read3];
  const local = { seed, label: "module 34", nested: { depth: 34 } };
  return readers.length + local.nested.depth + local.label.length;
}

// FILE: module35.ts
import type { Shared5, Kind5, Box5 } from "./types5.ts";
import type { Shared2, Kind2, Box2 } from "./types2.ts";
function read5(shared: Shared5, kind: Kind5, box: Box5<number>, texts: Box5<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field11 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
function read2(shared: Shared2, kind: Kind2, box: Box2<number>, texts: Box2<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field11 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
export function run35(seed: number): number {
  const readers = [read5, read2];
  const local = { seed, label: "module 35", nested: { depth: 35 } };
  return readers.length + local.nested.depth + local.label.length;
}

// FILE: module36.ts
import type { Shared0, Kind0, Box0 } from "./types0.ts";
import type { Shared1, Kind1, Box1 } from "./types1.ts";
function read0(shared: Shared0, kind: Kind0, box: Box0<number>, texts: Box0<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field0 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
function read1(shared: Shared1, kind: Kind1, box: Box1<number>, texts: Box1<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field0 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
export function run36(seed: number): number {
  const readers = [read0, read1];
  const local = { seed, label: "module 36", nested: { depth: 36 } };
  return readers.length + local.nested.depth + local.label.length;
}

// FILE: module37.ts
import type { Shared1, Kind1, Box1 } from "./types1.ts";
import type { Shared0, Kind0, Box0 } from "./types0.ts";
function read1(shared: Shared1, kind: Kind1, box: Box1<number>, texts: Box1<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field1 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
function read0(shared: Shared0, kind: Kind0, box: Box0<number>, texts: Box0<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field1 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
export function run37(seed: number): number {
  const readers = [read1, read0];
  const local = { seed, label: "module 37", nested: { depth: 37 } };
  return readers.length + local.nested.depth + local.label.length;
}

// FILE: module38.ts
import type { Shared2, Kind2, Box2 } from "./types2.ts";
import type { Shared5, Kind5, Box5 } from "./types5.ts";
function read2(shared: Shared2, kind: Kind2, box: Box2<number>, texts: Box2<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field2 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
function read5(shared: Shared5, kind: Kind5, box: Box5<number>, texts: Box5<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field2 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
export function run38(seed: number): number {
  const readers = [read2, read5];
  const local = { seed, label: "module 38", nested: { depth: 38 } };
  return readers.length + local.nested.depth + local.label.length;
}

// FILE: module39.ts
import type { Shared3, Kind3, Box3 } from "./types3.ts";
import type { Shared4, Kind4, Box4 } from "./types4.ts";
function read3(shared: Shared3, kind: Kind3, box: Box3<number>, texts: Box3<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field3 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
function read4(shared: Shared4, kind: Kind4, box: Box4<number>, texts: Box4<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field3 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
export function run39(seed: number): number {
  const readers = [read3, read4];
  const local = { seed, label: "module 39", nested: { depth: 39 } };
  return readers.length + local.nested.depth + local.label.length;
}

// FILE: module40.ts
import type { Shared4, Kind4, Box4 } from "./types4.ts";
import type { Shared3, Kind3, Box3 } from "./types3.ts";
function read4(shared: Shared4, kind: Kind4, box: Box4<number>, texts: Box4<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field4 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
function read3(shared: Shared3, kind: Kind3, box: Box3<number>, texts: Box3<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field4 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
export function run40(seed: number): number {
  const readers = [read4, read3];
  const local = { seed, label: "module 40", nested: { depth: 40 } };
  return readers.length + local.nested.depth + local.label.length;
}

// FILE: module41.ts
import type { Shared5, Kind5, Box5 } from "./types5.ts";
import type { Shared2, Kind2, Box2 } from "./types2.ts";
function read5(shared: Shared5, kind: Kind5, box: Box5<number>, texts: Box5<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field5 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
function read2(shared: Shared2, kind: Kind2, box: Box2<number>, texts: Box2<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field5 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
export function run41(seed: number): number {
  const readers = [read5, read2];
  const local = { seed, label: "module 41", nested: { depth: 41 } };
  return readers.length + local.nested.depth + local.label.length;
}

// FILE: module42.ts
import type { Shared0, Kind0, Box0 } from "./types0.ts";
import type { Shared1, Kind1, Box1 } from "./types1.ts";
function read0(shared: Shared0, kind: Kind0, box: Box0<number>, texts: Box0<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field6 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
function read1(shared: Shared1, kind: Kind1, box: Box1<number>, texts: Box1<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field6 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
export function run42(seed: number): number {
  const readers = [read0, read1];
  const local = { seed, label: "module 42", nested: { depth: 42 } };
  return readers.length + local.nested.depth + local.label.length;
}

// FILE: module43.ts
import type { Shared1, Kind1, Box1 } from "./types1.ts";
import type { Shared0, Kind0, Box0 } from "./types0.ts";
function read1(shared: Shared1, kind: Kind1, box: Box1<number>, texts: Box1<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field7 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
function read0(shared: Shared0, kind: Kind0, box: Box0<number>, texts: Box0<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field7 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
export function run43(seed: number): number {
  const readers = [read1, read0];
  const local = { seed, label: "module 43", nested: { depth: 43 } };
  return readers.length + local.nested.depth + local.label.length;
}

// FILE: module44.ts
import type { Shared2, Kind2, Box2 } from "./types2.ts";
import type { Shared5, Kind5, Box5 } from "./types5.ts";
function read2(shared: Shared2, kind: Kind2, box: Box2<number>, texts: Box2<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field8 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
function read5(shared: Shared5, kind: Kind5, box: Box5<number>, texts: Box5<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field8 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
export function run44(seed: number): number {
  const readers = [read2, read5];
  const local = { seed, label: "module 44", nested: { depth: 44 } };
  return readers.length + local.nested.depth + local.label.length;
}

// FILE: module45.ts
import type { Shared3, Kind3, Box3 } from "./types3.ts";
import type { Shared4, Kind4, Box4 } from "./types4.ts";
function read3(shared: Shared3, kind: Kind3, box: Box3<number>, texts: Box3<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field9 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
function read4(shared: Shared4, kind: Kind4, box: Box4<number>, texts: Box4<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field9 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
export function run45(seed: number): number {
  const readers = [read3, read4];
  const local = { seed, label: "module 45", nested: { depth: 45 } };
  return readers.length + local.nested.depth + local.label.length;
}

// FILE: module46.ts
import type { Shared4, Kind4, Box4 } from "./types4.ts";
import type { Shared3, Kind3, Box3 } from "./types3.ts";
function read4(shared: Shared4, kind: Kind4, box: Box4<number>, texts: Box4<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field10 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
function read3(shared: Shared3, kind: Kind3, box: Box3<number>, texts: Box3<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field10 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
export function run46(seed: number): number {
  const readers = [read4, read3];
  const local = { seed, label: "module 46", nested: { depth: 46 } };
  return readers.length + local.nested.depth + local.label.length;
}

// FILE: module47.ts
import type { Shared5, Kind5, Box5 } from "./types5.ts";
import type { Shared2, Kind2, Box2 } from "./types2.ts";
function read5(shared: Shared5, kind: Kind5, box: Box5<number>, texts: Box5<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field11 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
function read2(shared: Shared2, kind: Kind2, box: Box2<number>, texts: Box2<string>): number {
  let sum = shared.id + shared.name.length + box.value + texts.items.length;
  if (shared.next) sum += shared.next.id;
  if (shared.field11 != null) sum++;
  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;
}
export function run47(seed: number): number {
  const readers = [read5, read2];
  const local = { seed, label: "module 47", nested: { depth: 47 } };
  return readers.length + local.nested.depth + local.label.length;
}
