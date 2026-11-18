import * as b from "../../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::api::geometry", feature: "Desktop", membersInTable: false, isCold: true });

const heap = { capability: "heap" } as const;
const fallible = { capability: "heap", throws: true } as const;
const double = b.f64.loose;
const or = (value: number) => double.default(value);
const each = <T>(names: string[], make: (name: string, index: number) => T) =>
  Object.fromEntries(names.map((name, index) => [name, make(name, index)]));
const readOnly = { getter: b.f64, pure: true } as const;
const writable = { getter: b.f64, setter: { type: double }, pure: true } as const;

export const DOMPointInit = b.dictionary({ x: or(0), y: or(0), z: or(0), w: or(1) }, { webidl: true });
export const DOMRectInit = b.dictionary({ x: or(0), y: or(0), width: or(0), height: or(0) }, { webidl: true });
export const DOMQuadInit = b.dictionary(
  each(["p1", "p2", "p3", "p4"], () => DOMPointInit.default({})),
  { webidl: true },
);
export const DOMMatrix2DInit = b.dictionary(
  each(["a", "b", "c", "d", "e", "f", "m11", "m12", "m21", "m22", "m41", "m42"], () => double.optional),
  { webidl: true },
);
export const DOMMatrixInit = b.dictionary(
  {
    ...each(["m13", "m14", "m23", "m24", "m31", "m32", "m34", "m43"], () => or(0)),
    m33: or(1),
    m44: or(1),
    is2D: { type: b.bool.loose.optional, rustName: "is_2d" },
  },
  { webidl: true, extends: DOMMatrix2DInit },
);

const point = { x: or(0), y: or(0), z: or(0), w: or(1) };
const coordinates = Object.keys(point);

export const DOMPointReadOnly = b.interface("DOMPointReadOnly", {
  exposed: ["Window", "Worker"],
  defaultToJSON: true,
  rustPath: "crate::api::geometry::DOMPointReadOnly",
  serializable: true,
  construct: { args: point },
  static: { fromPoint: { args: { other: DOMPointInit.default({}) }, returns: b.ref("DOMPointReadOnly"), ...heap } },
  proto: {
    ...each(coordinates, () => readOnly),
    matrixTransform: { args: { matrix: DOMMatrixInit.default({}) }, returns: b.ref("DOMPoint"), ...fallible },
  },
});

export const DOMPoint = b.interface("DOMPoint", {
  exposed: ["Window", "Worker"],
  extends: DOMPointReadOnly,
  serializable: true,
  construct: { args: point },
  static: { fromPoint: { args: { other: DOMPointInit.default({}) }, returns: b.ref("DOMPoint"), ...heap } },
  proto: each(coordinates, () => writable),
});

const rect = { x: or(0), y: or(0), width: or(0), height: or(0) };

export const DOMRectReadOnly = b.interface("DOMRectReadOnly", {
  isCold: false,
  exposed: ["Window", "Worker"],
  defaultToJSON: true,
  rustPath: "crate::api::geometry::DOMRectReadOnly",
  serializable: true,
  construct: { args: rect },
  static: { fromRect: { args: { other: DOMRectInit.default({}) }, returns: b.ref("DOMRectReadOnly"), ...heap } },
  proto: {
    ...each([...Object.keys(rect), "top", "right", "bottom", "left"], () => readOnly),
  },
});

export const DOMRect = b.interface("DOMRect", {
  exposed: ["Window", "Worker"],
  extends: DOMRectReadOnly,
  serializable: true,
  construct: { args: rect },
  static: { fromRect: { args: { other: DOMRectInit.default({}) }, returns: b.ref("DOMRect"), ...heap } },
  proto: each(Object.keys(rect), () => writable),
});

export const DOMRectList = b.interface("DOMRectList", {
  rustPath: "crate::api::geometry::DOMRectList",
  internalFields: ["rects"],
  exposed: ["Window"],
  indexed: { getter: b.any },
  proto: {
    length: { getter: b.u32, pure: true },
    item: { args: { index: b.u32.wrap }, returns: b.ref("DOMRect").nullable, ...heap },
  },
});

const corners = ["p1", "p2", "p3", "p4"];

export const DOMQuad = b.interface("DOMQuad", {
  exposed: ["Window", "Worker"],
  defaultToJSON: true,
  serializable: true,
  internalFields: each(corners, () => DOMPoint),
  construct: { args: each(corners, () => DOMPointInit.default({})), passStructure: true, ...heap },
  static: {
    fromRect: { args: { other: DOMRectInit.default({}) }, returns: b.ref("DOMQuad"), ...heap },
    fromQuad: { args: { other: DOMQuadInit.default({}) }, returns: b.ref("DOMQuad"), ...heap },
  },
  proto: {
    ...each(corners, field => ({ getter: b.ref("DOMPoint"), field })),
    getBounds: { returns: b.ref("DOMRect"), ...heap },
  },
});

export const MatrixSource = b.union({ numbers: b.sequenceVec(double), text: b.DOMString.utf8 }, { webidl: true });

const matrix = (self: ReturnType<typeof b.ref>) => ({
  serializable: true as const,
  construct: { args: { init: MatrixSource.optional }, ...fallible },
  static: {
    fromMatrix: { args: { other: DOMMatrixInit.default({}) }, returns: self, ...fallible },
    fromFloat32Array: { args: { array32: b.typedArray("Float32Array") }, returns: self, ...fallible },
    fromFloat64Array: { args: { array64: b.typedArray("Float64Array") }, returns: self, ...fallible },
  },
});

const elements = {
  ...{ a: 0, b: 1, c: 4, d: 5, e: 12, f: 13 },
  ...each(
    [1, 2, 3, 4].flatMap(column => [1, 2, 3, 4].map(row => `m${column}${row}`)),
    (_, index) => index,
  ),
};
const origin = { originX: or(0), originY: or(0), originZ: or(0) };
const operations = {
  translate: { tx: or(0), ty: or(0), tz: or(0) },
  scale: { scaleX: or(1), scaleY: double.optional, scaleZ: or(1), ...origin },
  scale3d: { scale: or(1), ...origin },
  rotate: { rotX: or(0), rotY: double.optional, rotZ: double.optional },
  rotateFromVector: { x: or(0), y: or(0) },
  rotateAxisAngle: { x: or(0), y: or(0), z: or(0), angle: or(0) },
  skewX: { sx: or(0) },
  skewY: { sy: or(0) },
};
const other = { other: DOMMatrixInit.default({}) };
const copy = { returns: b.ref("DOMMatrix"), ...heap } as const;
const self = { returns: b.ref("DOMMatrix") } as const;

export const AnyMatrix = b.interface("AnyMatrix", { abstract: true, rustPath: "crate::api::geometry::AnyMatrix" });
export const MatrixElement = b.family("MatrixElement", { on: AnyMatrix, key: "usize", getter: double, setter: true });

export const DOMMatrixReadOnly = b.interface("DOMMatrixReadOnly", {
  exposed: ["Window", "Worker"],
  defaultToJSON: true,
  ...matrix(b.ref("DOMMatrixReadOnly")),
  extends: AnyMatrix,
  proto: {
    ...each(Object.keys(elements), name => MatrixElement.of(`${elements[name]}`, { setter: undefined })),
    is2D: { getter: b.bool, pure: true, rustName: "is_2d" },
    isIdentity: { getter: b.bool, pure: true },
    ...each(Object.keys(operations), name => ({ args: operations[name], ...copy })),
    scaleNonUniform: { args: { scaleX: or(1), scaleY: or(1) }, ...copy },
    multiply: { args: other, ...copy, throws: true },
    flipX: copy,
    flipY: copy,
    inverse: copy,
    transformPoint: { args: { point: DOMPointInit.default({}) }, returns: b.ref("DOMPoint"), ...heap },
    toFloat32Array: { returns: b.typedArray("Float32Array"), ...fallible },
    toFloat64Array: { returns: b.typedArray("Float64Array"), ...fallible },
    toString: { returns: b.string.utf8, exposed: ["Window"] as const, rustName: "stringify", ...fallible },
  },
});

export const DOMMatrix = b.interface("DOMMatrix", {
  exposed: ["Window", "Worker"],
  ...matrix(b.ref("DOMMatrix")),
  extends: DOMMatrixReadOnly,
  aliases: ["WebKitCSSMatrix"],
  proto: {
    ...each(Object.keys(elements), name => MatrixElement.of(`${elements[name]}`)),
    multiplySelf: { args: other, ...self, ...fallible },
    preMultiplySelf: { args: other, ...self, ...fallible },
    ...Object.fromEntries(Object.entries(operations).map(([name, args]) => [name + "Self", { args, ...self }])),
    invertSelf: self,
    setMatrixValue: { args: { transformList: b.DOMString.utf8 }, exposed: ["Window"], ...self, ...fallible },
  },
});
