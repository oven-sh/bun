// RUN: lower
// OPTIONS: builtin-modules

// A condition on constants is decided as ECMAScript decides it, or not at all: NaN, -0, coercions, bigints, getters, effects. Every line is what plain Bun prints.
const log: string[] = []
const say = (name: string, value: unknown) => void log.push(name + ": " + (Object.is(value, -0) ? "-0" : String(value)))
const NAN: any = NaN
const MINUS_ZERO: any = -0
const ZERO: any = 0
const ONE: any = 1
const EMPTY: any = ""
const SPACE: any = " "
const TEXT_ZERO: any = "0"
const TEXT_ONE: any = "1"
const NULL: any = null
const UNDEFINED: any = undefined
const TRUE: any = true
const FALSE: any = false
const BIG_ZERO: any = 0n
const BIG_ONE: any = 1n

say("truthiness", [NAN ? 1 : 0, MINUS_ZERO ? 1 : 0, ZERO ? 1 : 0, ONE ? 1 : 0, EMPTY ? 1 : 0, SPACE ? 1 : 0, TEXT_ZERO ? 1 : 0, NULL ? 1 : 0, UNDEFINED ? 1 : 0, BIG_ZERO ? 1 : 0, BIG_ONE ? 1 : 0])
say("not", [!NAN, !MINUS_ZERO, !EMPTY, !TEXT_ZERO, !NULL, !BIG_ZERO, !BIG_ONE, !!SPACE])
say("and", [NAN && "right", MINUS_ZERO && "right", EMPTY && "right", TEXT_ZERO && "right", BIG_ZERO && "right", NULL && "right"].map(value => (Object.is(value, -0) ? "-0" : String(value))))
say("or", [NAN || "right", MINUS_ZERO || "right", EMPTY || "right", TEXT_ZERO || "right", BIG_ZERO || "right", BIG_ONE || "right"])
say("nullish", [NAN ?? "right", ZERO ?? "right", EMPTY ?? "right", FALSE ?? "right", NULL ?? "right", UNDEFINED ?? "right", BIG_ZERO ?? "right"])

say("strictly equal", [NAN === NAN, NAN !== NAN, ZERO === MINUS_ZERO, TEXT_ONE === ONE, NULL === UNDEFINED, BIG_ONE === ONE, EMPTY === EMPTY, TRUE === ONE])
say("loosely equal", [NULL == UNDEFINED, NULL == ZERO, NULL == EMPTY, NULL == FALSE, UNDEFINED == ZERO, TEXT_ONE == ONE, EMPTY == ZERO, SPACE == ZERO, TEXT_ZERO == ZERO, TEXT_ZERO == FALSE])
say("loosely equal, more", [TRUE == ONE, TRUE == TEXT_ONE, NAN == NAN, NAN != NAN, BIG_ONE == ONE, BIG_ONE == TEXT_ONE, BIG_ZERO == EMPTY, BIG_ZERO == FALSE, ZERO == MINUS_ZERO])
say("ordered", ["10" < "9", ("10" as any) < 9, NULL >= ZERO, NULL > ZERO, UNDEFINED >= ZERO, NAN < ONE, NAN >= ONE, BIG_ONE < 2, TEXT_ONE < 2, EMPTY < ONE, MINUS_ZERO < ZERO])

say("sums", [ONE + TEXT_ONE, TEXT_ONE + ONE, TEXT_ONE - ONE, TRUE + ONE, NULL + ONE, UNDEFINED + ONE, EMPTY + MINUS_ZERO, EMPTY + NAN, EMPTY + 1e21, EMPTY + 0.1 * 3, BIG_ONE + BIG_ONE])
say("sums decide", [ONE + TEXT_ONE === "11" ? "text" : "number", TEXT_ONE - ONE ? "truthy" : "falsy", UNDEFINED + ONE ? "truthy" : "falsy", NULL + ZERO ? "truthy" : "falsy"])
say("division", [ONE / MINUS_ZERO, ONE / ZERO, ZERO / ZERO, ONE / MINUS_ZERO < 0 ? "below" : "not below", ZERO / ZERO ? "truthy" : "falsy", ZERO * -1, 1 / (ZERO * -1)])
say("remainder", [5 % -3, -5 % 3, -5 % 5, 1 / (-5 % 5), ONE % ZERO, -5 % 5 ? "truthy" : "falsy"].map(value => (Object.is(value, -0) ? "-0" : String(value))))
say("bits", [2 ** 31 | 0, 2 ** 32 | 0, 1 << 31, 1 << 32, -1 >>> 0, -1 >>> 32, -1 >> 31, 2 ** 53 | 0, NAN | 0, 1.9 | 0, -1.9 | 0, (1 << 31) < 0 ? "negative" : "not negative", -1 >>> 0 > 0 ? "positive" : "not positive"])
say("negation", [-ZERO, -MINUS_ZERO, -NAN, -TEXT_ONE, -EMPTY, -NULL, -UNDEFINED, -ZERO ? "truthy" : "falsy"].map(value => (Object.is(value, -0) ? "-0" : String(value))))
say("typeof", [typeof NAN, typeof NULL, typeof UNDEFINED, typeof EMPTY, typeof BIG_ZERO, typeof TRUE, typeof NULL === "object" ? "an object" : "no object", typeof BIG_ZERO === "number" ? "a number" : "no number"])

let reads = 0
const holder = {
  get flag() {
    reads++
    return false
  },
}
class WithStatic {
  static get flag() {
    reads++
    return 0
  }
}
const coerces: any = {
  valueOf() {
    reads++
    return 0
  },
  toString() {
    reads++
    return ""
  },
}
say("getters", [holder.flag ? "truthy" : "falsy", holder.flag && "never", holder.flag || "right", WithStatic.flag ? "truthy" : "falsy", WithStatic.flag ?? "never"])
say("getters were read", reads)
say("an object that converts to zero", [coerces ? "truthy" : "falsy", !coerces, coerces == 0 ? "equal" : "not equal", coerces === 0 ? "same" : "not same", coerces + 1, `${coerces}` ? "truthy" : "falsy", coerces ?? "never" ? "kept" : "not kept"])
say("conversions ran", reads)
const settings = { debug: false }
const flips = () => void (settings.debug = !settings.debug)
say("a property of a constant object", settings.debug ? "on" : "off")
flips()
say("the same, stored to since", settings.debug ? "on" : "off")

let effects = 0
const effect = () => ++effects
const VOID: any = void effect()
say("effects of tests", [VOID ? "truthy" : "falsy", (effect(), FALSE) ? "truthy" : "falsy", effect() && FALSE ? "truthy" : "falsy", (effect(), NULL) ?? "right", (effect(), NULL)?.never])
say("effects ran", effects)
say("chains", [NULL?.[effect()], UNDEFINED?.a.b.c, NULL?.(effect()), NULL?.a[effect()](effect()), ZERO?.toFixed(1), EMPTY?.length, NAN?.toString(), FALSE?.toString()])
say("nothing behind a null ran", effects)

function switches(): string[] {
  const seen: string[] = []
  switch (NAN) {
    case NaN:
      seen.push("NaN matches NaN")
      break
    default:
      seen.push("NaN matches nothing")
  }
  switch (MINUS_ZERO) {
    case 0:
      seen.push("-0 matches 0")
      break
    default:
      seen.push("-0 does not match 0")
  }
  switch (TEXT_ONE) {
    case 1:
      seen.push("a text matches a number")
      break
    case "1":
      seen.push("a text matches a text")
    case "2":
      seen.push("and falls through")
      break
    case "3":
      seen.push("never")
  }
  switch (ONE) {
    default:
      seen.push("the default comes first")
    case 2:
      seen.push("and falls through")
      break
    case 3:
      seen.push("never")
  }
  switch (BIG_ONE) {
    case 1:
      seen.push("a bigint matches a number")
      break
    case 1n:
      seen.push("a bigint matches a bigint")
  }
  switch (ONE) {
    case effect():
      seen.push("never")
      break
    case 1:
      seen.push("the tests before it ran")
  }
  return seen
}
say("switches", switches().join(" | "))
say("effects ran", effects)

function statements(): string[] {
  const seen: string[] = []
  if (NAN) seen.push("never")
  else seen.push("NaN is falsy")
  if (MINUS_ZERO) seen.push("never")
  if (TEXT_ZERO) seen.push("a text of a zero is truthy")
  if (BIG_ZERO) seen.push("never")
  while (EMPTY) seen.push("never")
  for (let i = 0; NULL; i++) seen.push("never")
  do seen.push("a body runs once")
  while (NAN)
  for (const key in NULL) seen.push("never " + key)
  label: {
    if (ONE) break label
    seen.push("never")
  }
  seen.push("behind the label")
  try {
    if (ONE) throw new Error("thrown")
    seen.push("never")
  } catch (error) {
    seen.push((error as Error).message)
  } finally {
    seen.push("finally")
  }
  for (const n of [1, 2, 3]) {
    if (ZERO) continue
    if (n === 2 && ONE) break
    seen.push("n " + n)
  }
  seen.push(hoisted())
  return seen
  function hoisted() {
    return "declared behind the return"
  }
}
say("statements", statements().join(" | "))
console.log(log.join("\n"))

// GENERATED: WithStatic flag say flips
// CHECK-LABEL: function {{*}}name="WithStatic"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_1]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="flag"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=number site=[[w_2]]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="reads"
// CHECK-NEXT: v2 = Increment v1
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_4]]}
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v5 = CheckInitialized v4 name="reads"
// CHECK-NEXT: PutModuleVariable v3 variable=[[g_3]]
// CHECK-NEXT: v7 = Integer
// CHECK-NEXT: v8 = Convert v7 declared={type=number site=[[w_2]]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="say"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}, {type=anything}] results=[{type=undefined site=[[w_6]]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="log"
// CHECK-NEXT: v4 = PropGet v3 key="push"
// CHECK-NEXT: v5 = String string=": "
// CHECK-NEXT: v6 = Add v0, v5
// CHECK-NEXT: v7 = Builtin builtin=Object
// CHECK-NEXT: v8 = Builtin builtin=ObjectIs
// CHECK-NEXT: v9 = Double number=-0
// CHECK-NEXT: v10 = Call v8, v7, v1, v9 calleeName="Object.is"
// CHECK-NEXT: v11 = Convert v10 declared={type=boolean site=[[w_9]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v12 = ToBoolean v11
// CHECK-NEXT: Branch v12 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v13):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v14 = String string="-0"
// CHECK-NEXT: Jump -> next b6(v14)
// CHECK-NEXT: b4(v15):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v16 = Builtin builtin=String
// CHECK-NEXT: v17 = Call v16, -, v1 calleeName="String"
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Jump -> next b6(v18)
// CHECK-NEXT: b6(v19):
// CHECK-NEXT: v20 = Add v6, v19
// CHECK-NEXT: v21 = Call v4, v3, v20 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v22 = Convert v21 declared={type=number site=[[w_11]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v23 = Undefined
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined site=[[w_6]]}
// CHECK-NEXT: Return v24
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="flag"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=boolean site=[[w_12]]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="reads"
// CHECK-NEXT: v2 = Increment v1
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_4]]}
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v5 = CheckInitialized v4 name="reads"
// CHECK-NEXT: PutModuleVariable v3 variable=[[g_3]]
// CHECK-NEXT: v7 = Boolean
// CHECK-NEXT: v8 = Convert v7 declared={type=boolean site=[[w_12]]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="flips"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=undefined site=[[w_13]]}] functionTypes={{*}}[[f_14]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_15]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="settings"
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_15]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="settings"
// CHECK-NEXT: v4 = PropGet v3 key="debug"
// CHECK-NEXT: v5 = ToBoolean v4
// CHECK-NEXT: v6 = LogicalNot v5
// CHECK-NEXT: v7 = Convert v6 declared={type=boolean site=[[w_16]]}
// CHECK-NEXT: PropSet v1, v7 key="debug"
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined site=[[w_13]]}
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
