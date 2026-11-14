// TODO: This depends on a separate buffer polyfill
import string_decoder from "./node_modules/string_decoder";
export var { StringDecoder } = string_decoder;
export { StringDecoder as default, string_decoder as "module.exports" };
