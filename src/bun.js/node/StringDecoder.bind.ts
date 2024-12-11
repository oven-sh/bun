// import { Class, Fn, t } from "bindgen";

// const Encoding = t.zigEnum("types.zig", "Encoding");

// export const StringDecoder = Class({
//   impl: ".",
//   methods: {
//     write: Fn({
//       variants: [
//         {
//           args: {
//             buffer: t.DOMString,
//           },
//           ret: t.DOMString,
//           // TODO: add something like "trivialImplementation: "returnArg1"
//         },
//         {
//           args: {
//             buffer: t.ArrayBuffer,
//           },
//           ret: t.DOMString,
//         },
//       ],
//     }),
//     end: Fn({
//       args: {
//         buffer: t.ArrayBuffer.optional,
//       },
//       ret: t.DOMString,
//     }),
//   },
//   properties: {
//     // lastChar: getter(t.any),
//     // encoding: getter(Encoding),
//     // lastNeed: getter(t.u8),
//     // lastTotal: getter(t.u8),
//   },
// });
