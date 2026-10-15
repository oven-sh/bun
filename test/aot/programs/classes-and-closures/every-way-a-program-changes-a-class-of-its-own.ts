// Every way a program changes one of its own classes. Each row has a separate class.
const other = function other() { return "other" }
function answer(f: () => unknown) { try { return String(f()) } catch (e) { return e instanceof TypeError ? "TypeError" : "other error" } }
function look(C: any, key: string, onPrototype: boolean) {
  const holder = onPrototype ? C.prototype : C, one = new C()
  const seen = onPrototype ? answer(() => { const v = one[key]; return typeof v === "function" ? (v === C ? "the class" : v === Object ? "Object" : v === other ? "other" : "a function") : v }) : answer(() => { const v = C[key]; return typeof v === "function" ? (v === other ? "other" : "a function") : v })
  return [Object.hasOwn(holder, key), seen, answer(() => one.method()), answer(() => one.calls()), answer(() => C.fixed())].join(" ")
}

class C1 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } }
{ const a = answer(() => delete (C1.prototype as any).constructor); console.log("outside | prototype.constructor | delete:", a, "|", look(C1, "constructor", true)) }
class C2 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } }
{ const a = answer(() => Reflect.deleteProperty(C2.prototype, "constructor")); console.log("outside | prototype.constructor | Reflect.deleteProperty:", a, "|", look(C2, "constructor", true)) }
class C3 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } }
{ const a = answer(() => ((C3.prototype as any).constructor = other) === other); console.log("outside | prototype.constructor | assign:", a, "|", look(C3, "constructor", true)) }
class C4 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } }
{ const a = answer(() => Reflect.set(C4.prototype, "constructor", other)); console.log("outside | prototype.constructor | Reflect.set:", a, "|", look(C4, "constructor", true)) }
class C5 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } }
{ const a = answer(() => Object.defineProperty(C5.prototype, "constructor", { value: other, configurable: true, writable: true }) === C5.prototype); console.log("outside | prototype.constructor | Object.defineProperty:", a, "|", look(C5, "constructor", true)) }
class C6 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } }
{ const a = answer(() => Reflect.defineProperty(C6.prototype, "constructor", { value: other, configurable: true, writable: true })); console.log("outside | prototype.constructor | Reflect.defineProperty:", a, "|", look(C6, "constructor", true)) }
class C7 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } }
{ const a = answer(() => delete (C7.prototype as any).method); console.log("outside | prototype.method | delete:", a, "|", look(C7, "method", true)) }
class C8 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } }
{ const a = answer(() => Reflect.deleteProperty(C8.prototype, "method")); console.log("outside | prototype.method | Reflect.deleteProperty:", a, "|", look(C8, "method", true)) }
class C9 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } }
{ const a = answer(() => ((C9.prototype as any).method = other) === other); console.log("outside | prototype.method | assign:", a, "|", look(C9, "method", true)) }
class C10 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } }
{ const a = answer(() => Reflect.set(C10.prototype, "method", other)); console.log("outside | prototype.method | Reflect.set:", a, "|", look(C10, "method", true)) }
class C11 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } }
{ const a = answer(() => Object.defineProperty(C11.prototype, "method", { value: other, configurable: true, writable: true }) === C11.prototype); console.log("outside | prototype.method | Object.defineProperty:", a, "|", look(C11, "method", true)) }
class C12 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } }
{ const a = answer(() => Reflect.defineProperty(C12.prototype, "method", { value: other, configurable: true, writable: true })); console.log("outside | prototype.method | Reflect.defineProperty:", a, "|", look(C12, "method", true)) }
class C13 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } }
{ const a = answer(() => delete (C13.prototype as any).got); console.log("outside | prototype.got | delete:", a, "|", look(C13, "got", true)) }
class C14 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } }
{ const a = answer(() => Reflect.deleteProperty(C14.prototype, "got")); console.log("outside | prototype.got | Reflect.deleteProperty:", a, "|", look(C14, "got", true)) }
class C15 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } }
{ const a = answer(() => ((C15.prototype as any).got = other) === other); console.log("outside | prototype.got | assign:", a, "|", look(C15, "got", true)) }
class C16 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } }
{ const a = answer(() => Reflect.set(C16.prototype, "got", other)); console.log("outside | prototype.got | Reflect.set:", a, "|", look(C16, "got", true)) }
class C17 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } }
{ const a = answer(() => Object.defineProperty(C17.prototype, "got", { value: other, configurable: true, writable: true }) === C17.prototype); console.log("outside | prototype.got | Object.defineProperty:", a, "|", look(C17, "got", true)) }
class C18 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } }
{ const a = answer(() => Reflect.defineProperty(C18.prototype, "got", { value: other, configurable: true, writable: true })); console.log("outside | prototype.got | Reflect.defineProperty:", a, "|", look(C18, "got", true)) }
class C19 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } }
{ const a = answer(() => delete (C19.prototype as any).absent); console.log("outside | prototype.absent | delete:", a, "|", look(C19, "absent", true)) }
class C20 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } }
{ const a = answer(() => Reflect.deleteProperty(C20.prototype, "absent")); console.log("outside | prototype.absent | Reflect.deleteProperty:", a, "|", look(C20, "absent", true)) }
class C21 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } }
{ const a = answer(() => ((C21.prototype as any).absent = other) === other); console.log("outside | prototype.absent | assign:", a, "|", look(C21, "absent", true)) }
class C22 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } }
{ const a = answer(() => Reflect.set(C22.prototype, "absent", other)); console.log("outside | prototype.absent | Reflect.set:", a, "|", look(C22, "absent", true)) }
class C23 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } }
{ const a = answer(() => Object.defineProperty(C23.prototype, "absent", { value: other, configurable: true, writable: true }) === C23.prototype); console.log("outside | prototype.absent | Object.defineProperty:", a, "|", look(C23, "absent", true)) }
class C24 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } }
{ const a = answer(() => Reflect.defineProperty(C24.prototype, "absent", { value: other, configurable: true, writable: true })); console.log("outside | prototype.absent | Reflect.defineProperty:", a, "|", look(C24, "absent", true)) }
class C25 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } }
{ const a = answer(() => delete (C25 as any).fixed); console.log("outside | class.fixed | delete:", a, "|", look(C25, "fixed", false)) }
class C26 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } }
{ const a = answer(() => Reflect.deleteProperty(C26, "fixed")); console.log("outside | class.fixed | Reflect.deleteProperty:", a, "|", look(C26, "fixed", false)) }
class C27 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } }
{ const a = answer(() => ((C27 as any).fixed = other) === other); console.log("outside | class.fixed | assign:", a, "|", look(C27, "fixed", false)) }
class C28 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } }
{ const a = answer(() => Reflect.set(C28, "fixed", other)); console.log("outside | class.fixed | Reflect.set:", a, "|", look(C28, "fixed", false)) }
class C29 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } }
{ const a = answer(() => Object.defineProperty(C29, "fixed", { value: other, configurable: true, writable: true }) === C29); console.log("outside | class.fixed | Object.defineProperty:", a, "|", look(C29, "fixed", false)) }
class C30 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } }
{ const a = answer(() => Reflect.defineProperty(C30, "fixed", { value: other, configurable: true, writable: true })); console.log("outside | class.fixed | Reflect.defineProperty:", a, "|", look(C30, "fixed", false)) }
class C31 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } }
{ const a = answer(() => delete (C31 as any).absent); console.log("outside | class.absent | delete:", a, "|", look(C31, "absent", false)) }
class C32 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } }
{ const a = answer(() => Reflect.deleteProperty(C32, "absent")); console.log("outside | class.absent | Reflect.deleteProperty:", a, "|", look(C32, "absent", false)) }
class C33 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } }
{ const a = answer(() => ((C33 as any).absent = other) === other); console.log("outside | class.absent | assign:", a, "|", look(C33, "absent", false)) }
class C34 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } }
{ const a = answer(() => Reflect.set(C34, "absent", other)); console.log("outside | class.absent | Reflect.set:", a, "|", look(C34, "absent", false)) }
class C35 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } }
{ const a = answer(() => Object.defineProperty(C35, "absent", { value: other, configurable: true, writable: true }) === C35); console.log("outside | class.absent | Object.defineProperty:", a, "|", look(C35, "absent", false)) }
class C36 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } }
{ const a = answer(() => Reflect.defineProperty(C36, "absent", { value: other, configurable: true, writable: true })); console.log("outside | class.absent | Reflect.defineProperty:", a, "|", look(C36, "absent", false)) }
class C37 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } }
{ const a = answer(() => delete (C37 as any).name); console.log("outside | class.name | delete:", a, "|", look(C37, "name", false)) }
class C38 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } }
{ const a = answer(() => Reflect.deleteProperty(C38, "name")); console.log("outside | class.name | Reflect.deleteProperty:", a, "|", look(C38, "name", false)) }
class C39 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } }
{ const a = answer(() => ((C39 as any).name = other) === other); console.log("outside | class.name | assign:", a, "|", look(C39, "name", false)) }
class C40 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } }
{ const a = answer(() => Reflect.set(C40, "name", other)); console.log("outside | class.name | Reflect.set:", a, "|", look(C40, "name", false)) }
class C41 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } }
{ const a = answer(() => Object.defineProperty(C41, "name", { value: other, configurable: true, writable: true }) === C41); console.log("outside | class.name | Object.defineProperty:", a, "|", look(C41, "name", false)) }
class C42 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } }
{ const a = answer(() => Reflect.defineProperty(C42, "name", { value: other, configurable: true, writable: true })); console.log("outside | class.name | Reflect.defineProperty:", a, "|", look(C42, "name", false)) }
let a43 = ""
class C43 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } static { a43 = answer(() => delete (C43.prototype as any).constructor) } }
console.log("static block | prototype.constructor | delete:", a43, "|", look(C43, "constructor", true))
let a44 = ""
class C44 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } static { a44 = answer(() => Reflect.deleteProperty(C44.prototype, "constructor")) } }
console.log("static block | prototype.constructor | Reflect.deleteProperty:", a44, "|", look(C44, "constructor", true))
let a45 = ""
class C45 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } static { a45 = answer(() => ((C45.prototype as any).constructor = other) === other) } }
console.log("static block | prototype.constructor | assign:", a45, "|", look(C45, "constructor", true))
let a46 = ""
class C46 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } static { a46 = answer(() => Reflect.set(C46.prototype, "constructor", other)) } }
console.log("static block | prototype.constructor | Reflect.set:", a46, "|", look(C46, "constructor", true))
let a47 = ""
class C47 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } static { a47 = answer(() => Object.defineProperty(C47.prototype, "constructor", { value: other, configurable: true, writable: true }) === C47.prototype) } }
console.log("static block | prototype.constructor | Object.defineProperty:", a47, "|", look(C47, "constructor", true))
let a48 = ""
class C48 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } static { a48 = answer(() => Reflect.defineProperty(C48.prototype, "constructor", { value: other, configurable: true, writable: true })) } }
console.log("static block | prototype.constructor | Reflect.defineProperty:", a48, "|", look(C48, "constructor", true))
let a49 = ""
class C49 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } static { a49 = answer(() => delete (C49.prototype as any).method) } }
console.log("static block | prototype.method | delete:", a49, "|", look(C49, "method", true))
let a50 = ""
class C50 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } static { a50 = answer(() => Reflect.deleteProperty(C50.prototype, "method")) } }
console.log("static block | prototype.method | Reflect.deleteProperty:", a50, "|", look(C50, "method", true))
let a51 = ""
class C51 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } static { a51 = answer(() => ((C51.prototype as any).method = other) === other) } }
console.log("static block | prototype.method | assign:", a51, "|", look(C51, "method", true))
let a52 = ""
class C52 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } static { a52 = answer(() => Reflect.set(C52.prototype, "method", other)) } }
console.log("static block | prototype.method | Reflect.set:", a52, "|", look(C52, "method", true))
let a53 = ""
class C53 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } static { a53 = answer(() => Object.defineProperty(C53.prototype, "method", { value: other, configurable: true, writable: true }) === C53.prototype) } }
console.log("static block | prototype.method | Object.defineProperty:", a53, "|", look(C53, "method", true))
let a54 = ""
class C54 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } static { a54 = answer(() => Reflect.defineProperty(C54.prototype, "method", { value: other, configurable: true, writable: true })) } }
console.log("static block | prototype.method | Reflect.defineProperty:", a54, "|", look(C54, "method", true))
let a55 = ""
class C55 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } static { a55 = answer(() => delete (C55.prototype as any).got) } }
console.log("static block | prototype.got | delete:", a55, "|", look(C55, "got", true))
let a56 = ""
class C56 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } static { a56 = answer(() => Reflect.deleteProperty(C56.prototype, "got")) } }
console.log("static block | prototype.got | Reflect.deleteProperty:", a56, "|", look(C56, "got", true))
let a57 = ""
class C57 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } static { a57 = answer(() => ((C57.prototype as any).got = other) === other) } }
console.log("static block | prototype.got | assign:", a57, "|", look(C57, "got", true))
let a58 = ""
class C58 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } static { a58 = answer(() => Reflect.set(C58.prototype, "got", other)) } }
console.log("static block | prototype.got | Reflect.set:", a58, "|", look(C58, "got", true))
let a59 = ""
class C59 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } static { a59 = answer(() => Object.defineProperty(C59.prototype, "got", { value: other, configurable: true, writable: true }) === C59.prototype) } }
console.log("static block | prototype.got | Object.defineProperty:", a59, "|", look(C59, "got", true))
let a60 = ""
class C60 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } static { a60 = answer(() => Reflect.defineProperty(C60.prototype, "got", { value: other, configurable: true, writable: true })) } }
console.log("static block | prototype.got | Reflect.defineProperty:", a60, "|", look(C60, "got", true))
let a61 = ""
class C61 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } static { a61 = answer(() => delete (C61.prototype as any).absent) } }
console.log("static block | prototype.absent | delete:", a61, "|", look(C61, "absent", true))
let a62 = ""
class C62 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } static { a62 = answer(() => Reflect.deleteProperty(C62.prototype, "absent")) } }
console.log("static block | prototype.absent | Reflect.deleteProperty:", a62, "|", look(C62, "absent", true))
let a63 = ""
class C63 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } static { a63 = answer(() => ((C63.prototype as any).absent = other) === other) } }
console.log("static block | prototype.absent | assign:", a63, "|", look(C63, "absent", true))
let a64 = ""
class C64 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } static { a64 = answer(() => Reflect.set(C64.prototype, "absent", other)) } }
console.log("static block | prototype.absent | Reflect.set:", a64, "|", look(C64, "absent", true))
let a65 = ""
class C65 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } static { a65 = answer(() => Object.defineProperty(C65.prototype, "absent", { value: other, configurable: true, writable: true }) === C65.prototype) } }
console.log("static block | prototype.absent | Object.defineProperty:", a65, "|", look(C65, "absent", true))
let a66 = ""
class C66 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } static { a66 = answer(() => Reflect.defineProperty(C66.prototype, "absent", { value: other, configurable: true, writable: true })) } }
console.log("static block | prototype.absent | Reflect.defineProperty:", a66, "|", look(C66, "absent", true))
let a67 = ""
class C67 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } static { a67 = answer(() => delete (C67 as any).fixed) } }
console.log("static block | class.fixed | delete:", a67, "|", look(C67, "fixed", false))
let a68 = ""
class C68 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } static { a68 = answer(() => Reflect.deleteProperty(C68, "fixed")) } }
console.log("static block | class.fixed | Reflect.deleteProperty:", a68, "|", look(C68, "fixed", false))
let a69 = ""
class C69 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } static { a69 = answer(() => ((C69 as any).fixed = other) === other) } }
console.log("static block | class.fixed | assign:", a69, "|", look(C69, "fixed", false))
let a70 = ""
class C70 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } static { a70 = answer(() => Reflect.set(C70, "fixed", other)) } }
console.log("static block | class.fixed | Reflect.set:", a70, "|", look(C70, "fixed", false))
let a71 = ""
class C71 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } static { a71 = answer(() => Object.defineProperty(C71, "fixed", { value: other, configurable: true, writable: true }) === C71) } }
console.log("static block | class.fixed | Object.defineProperty:", a71, "|", look(C71, "fixed", false))
let a72 = ""
class C72 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } static { a72 = answer(() => Reflect.defineProperty(C72, "fixed", { value: other, configurable: true, writable: true })) } }
console.log("static block | class.fixed | Reflect.defineProperty:", a72, "|", look(C72, "fixed", false))
let a73 = ""
class C73 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } static { a73 = answer(() => delete (C73 as any).absent) } }
console.log("static block | class.absent | delete:", a73, "|", look(C73, "absent", false))
let a74 = ""
class C74 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } static { a74 = answer(() => Reflect.deleteProperty(C74, "absent")) } }
console.log("static block | class.absent | Reflect.deleteProperty:", a74, "|", look(C74, "absent", false))
let a75 = ""
class C75 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } static { a75 = answer(() => ((C75 as any).absent = other) === other) } }
console.log("static block | class.absent | assign:", a75, "|", look(C75, "absent", false))
let a76 = ""
class C76 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } static { a76 = answer(() => Reflect.set(C76, "absent", other)) } }
console.log("static block | class.absent | Reflect.set:", a76, "|", look(C76, "absent", false))
let a77 = ""
class C77 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } static { a77 = answer(() => Object.defineProperty(C77, "absent", { value: other, configurable: true, writable: true }) === C77) } }
console.log("static block | class.absent | Object.defineProperty:", a77, "|", look(C77, "absent", false))
let a78 = ""
class C78 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } static { a78 = answer(() => Reflect.defineProperty(C78, "absent", { value: other, configurable: true, writable: true })) } }
console.log("static block | class.absent | Reflect.defineProperty:", a78, "|", look(C78, "absent", false))
let a79 = ""
class C79 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } static { a79 = answer(() => delete (C79 as any).name) } }
console.log("static block | class.name | delete:", a79, "|", look(C79, "name", false))
let a80 = ""
class C80 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } static { a80 = answer(() => Reflect.deleteProperty(C80, "name")) } }
console.log("static block | class.name | Reflect.deleteProperty:", a80, "|", look(C80, "name", false))
let a81 = ""
class C81 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } static { a81 = answer(() => ((C81 as any).name = other) === other) } }
console.log("static block | class.name | assign:", a81, "|", look(C81, "name", false))
let a82 = ""
class C82 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } static { a82 = answer(() => Reflect.set(C82, "name", other)) } }
console.log("static block | class.name | Reflect.set:", a82, "|", look(C82, "name", false))
let a83 = ""
class C83 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } static { a83 = answer(() => Object.defineProperty(C83, "name", { value: other, configurable: true, writable: true }) === C83) } }
console.log("static block | class.name | Object.defineProperty:", a83, "|", look(C83, "name", false))
let a84 = ""
class C84 { method() { return "method" } calls() { return this.method() } get got() { return "got" } static fixed() { return "fixed" } static { a84 = answer(() => Reflect.defineProperty(C84, "name", { value: other, configurable: true, writable: true })) } }
console.log("static block | class.name | Reflect.defineProperty:", a84, "|", look(C84, "name", false))
class C85 { method() { return "method" } calls() { return this.method() } static fixed() { return "fixed" } }
{ const a = answer(() => Object.setPrototypeOf(C85.prototype, { inherited: 1 }) === C85.prototype); console.log("outside | Object.setPrototypeOf(prototype):", a, "|", answer(() => (new C85() as any).inherited), answer(() => (C85 as any).inherited), answer(() => new C85().calls())) }
class C86 { method() { return "method" } calls() { return this.method() } static fixed() { return "fixed" } }
{ const a = answer(() => Reflect.setPrototypeOf(C86.prototype, { inherited: 1 })); console.log("outside | Reflect.setPrototypeOf(prototype):", a, "|", answer(() => (new C86() as any).inherited), answer(() => (C86 as any).inherited), answer(() => new C86().calls())) }
class C87 { method() { return "method" } calls() { return this.method() } static fixed() { return "fixed" } }
{ const a = answer(() => Object.setPrototypeOf(C87, { inherited: 1 }) === C87); console.log("outside | Object.setPrototypeOf(class):", a, "|", answer(() => (new C87() as any).inherited), answer(() => (C87 as any).inherited), answer(() => new C87().calls())) }
class C88 { method() { return "method" } calls() { return this.method() } static fixed() { return "fixed" } }
{ const a = answer(() => Reflect.setPrototypeOf(C88, { inherited: 1 })); console.log("outside | Reflect.setPrototypeOf(class):", a, "|", answer(() => (new C88() as any).inherited), answer(() => (C88 as any).inherited), answer(() => new C88().calls())) }
class C89 { method() { return "method" } calls() { return this.method() } static fixed() { return "fixed" } }
{ const a = answer(() => Object.isFrozen(Object.freeze(C89.prototype))); console.log("outside | Object.freeze(prototype):", a, "|", answer(() => (new C89() as any).inherited), answer(() => (C89 as any).inherited), answer(() => new C89().calls())) }
class C90 { method() { return "method" } calls() { return this.method() } static fixed() { return "fixed" } }
{ const a = answer(() => Object.isSealed(Object.seal(C90.prototype))); console.log("outside | Object.seal(prototype):", a, "|", answer(() => (new C90() as any).inherited), answer(() => (C90 as any).inherited), answer(() => new C90().calls())) }
class C91 { method() { return "method" } calls() { return this.method() } static fixed() { return "fixed" } }
{ const a = answer(() => Object.isExtensible(Object.preventExtensions(C91.prototype))); console.log("outside | Object.preventExtensions(prototype):", a, "|", answer(() => (new C91() as any).inherited), answer(() => (C91 as any).inherited), answer(() => new C91().calls())) }
class C92 { method() { return "method" } calls() { return this.method() } static fixed() { return "fixed" } }
{ const a = answer(() => Object.isFrozen(Object.freeze(C92))); console.log("outside | Object.freeze(class):", a, "|", answer(() => (new C92() as any).inherited), answer(() => (C92 as any).inherited), answer(() => new C92().calls())) }
class C93 { method() { return "method" } calls() { return this.method() } static fixed() { return "fixed" } }
{ const a = answer(() => Object.assign(C93.prototype, { method: other }) === C93.prototype); console.log("outside | Object.assign(prototype):", a, "|", answer(() => (new C93() as any).inherited), answer(() => (C93 as any).inherited), answer(() => new C93().calls())) }
