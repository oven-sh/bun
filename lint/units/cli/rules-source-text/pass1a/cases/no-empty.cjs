module.exports = [
  { code: "{}" }, { code: "{;}" }, { code: "{ 'use strict' }" }, { code: "{\n}" }, { code: "{ // c\n}" }, { code: "{/**/}" }, { code: "{\u00A0}" }, { code: "{\u2028}" }, { code: "{\uFEFF}" },
  { code: "if (a) {} else {}" }, { code: "for (;;) {}" }, { code: "while (a) {}" }, { code: "do {} while (a)" }, { code: "with (a) {}" }, { code: "a: {}" }, { code: "for (a in b) {}" }, { code: "for (a of b) {}" },
  { code: "try {} catch {} finally {}" }, { code: "try {} catch (e) {} finally /* c */ {}" }, { code: "try { /* c */ } catch (e) { // c\n } finally { /* c */ }" }, { code: "try {} finally\n{\n}" },
  { code: "switch (a) {}" }, { code: "switch (a) { /* c */ }" }, { code: "switch (a) /* c */ {}" }, { code: "switch ((a)) {\n}" }, { code: "switch (a) { default: }" }, { code: "switch (a) { case 1: {} }" },
  { code: "function f() {}" }, { code: "(function () {})" }, { code: "(() => {})" }, { code: "class A { m() {} static {} get a() {} constructor() {} }" }, { code: "({ m() {}, get a() {}, set a(v) {} })" }, { code: "async function* f() {}" },
  { code: "function f() { {} }" }, { code: "() => { if (a) {} }" }, { code: "class A { static { {} } }" }, { code: "class A { static { if (a) {} } }" },
  { code: "{ type A = 1 }", ext: "ts" }, { code: "{ interface I {} }", ext: "ts" }, { code: "{ declare const x: number }", ext: "ts" }, { code: "namespace N {}", ext: "ts" }, { code: "declare module 'm' {}", ext: "ts" }, { code: "class A { constructor(private a: number) {} }", ext: "ts" }, { code: "function f(): void {}\nif (a) {}", ext: "ts" }, { code: "switch (a as any) {}", ext: "ts" }, { code: "abstract class A { abstract m(): void; static {} }", ext: "ts" }, { code: "enum E {}", ext: "ts" },
  { code: "if (a) {\r\n}" }, { code: "label: for (;;) {}" }, { code: "if (a) {} // c" }, { code: "if (a) /* c */ {}" }, { code: "{ --> c\n}" }, { code: "{\n--> c\n}" },
];
