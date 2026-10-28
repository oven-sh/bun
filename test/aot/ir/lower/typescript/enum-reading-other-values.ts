// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: [[enum]] = FinishObject
// CHECK: [[five]] = Integer integer=5
// CHECK: PropSet [[enum]], [[five]] key="FromOwn"
// CHECK-NOT: ToPropertyKey
// CHECK: ElemSet [[enum]], [[five]],
// CHECK: PropSet [[enum]], {{*}}key="FromConst"
// CHECK: [[constKey]] = ToPropertyKey
// CHECK: ElemSet [[enum]], [[constKey]],
// CHECK-NOT: PropGet {{*}}key="Red"
// CHECK: [[red]] = Integer @
// CHECK: PropSet [[enum]], [[red]] key="FromImport"
// CHECK: [[importKey]] = ToPropertyKey
// CHECK: ElemSet [[enum]], [[importKey]],
// CHECK: = CheckInitialized {{*}}name="Shade"
// CHECK: = PropGet {{*}}key="Dark"
// CHECK: PropSet [[enum]], {{*}}key="FromHandedOn"
// CHECK: [[handedOnKey]] = ToPropertyKey
// CHECK: ElemSet [[enum]], [[handedOnKey]],
// CHECK: = PropGet {{*}}key="Value"
// CHECK: PropSet [[enum]], {{*}}key="FromAmbient"
// CHECK: [[ambientKey]] = ToPropertyKey
// CHECK: ElemSet [[enum]], [[ambientKey]],

import { Color, Shade } from "./imports/colors";

declare enum Ambient {
  Value = 7,
}

const base = 2;

export enum E {
  Own = 4,
  FromOwn = Own + 1,
  FromConst = base,
  FromImport = Color.Red,
  FromHandedOn = Shade.Dark,
  FromAmbient = Ambient.Value,
}

export const shades = Object.keys(Shade);
