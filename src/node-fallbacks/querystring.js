import querystring_module from "querystring-es3";
// In a classic script a top-level `var escape` replaces the page's own, so these two have other local names.
const { escape: querystringEscape, unescape: querystringUnescape } = querystring_module;
export var { unescapeBuffer, stringify, encode, parse, decode } = querystring_module;
export * as default from "querystring-es3";
export { querystringEscape as escape, querystringUnescape as unescape };
