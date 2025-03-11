/* Analyzed bindings: {
  "Hello": "setup-const",
  "ref": "setup-const",
  "msg": "setup-ref"
} */
import Hello from "./Hello.vue";
import { ref } from "vue";

const __sfc__ = {
  __name: "App",
  setup(__props, { expose: __expose }) {
    __expose();

    const msg = ref("Hello World!");

    const __returned__ = { msg, Hello, ref };
    Object.defineProperty(__returned__, "__isScriptSetup", { enumerable: false, value: true });
    return __returned__;
  },
};
import {
  createVNode as _createVNode,
  toDisplayString as _toDisplayString,
  createElementVNode as _createElementVNode,
  vModelText as _vModelText,
  withDirectives as _withDirectives,
  Fragment as _Fragment,
  openBlock as _openBlock,
  createElementBlock as _createElementBlock,
} from "vue";
function render(_ctx, _cache, $props, $setup, $data, $options) {
  return (
    _openBlock(),
    _createElementBlock(
      _Fragment,
      null,
      [
        _createVNode($setup["Hello"]),
        _createElementVNode("h1", null, _toDisplayString($setup.msg), 1 /* TEXT */),
        _withDirectives(
          _createElementVNode(
            "input",
            {
              "onUpdate:modelValue": _cache[0] || (_cache[0] = $event => ($setup.msg = $event)),
            },
            null,
            512 /* NEED_PATCH */,
          ),
          [[_vModelText, $setup.msg]],
        ),
      ],
      64 /* STABLE_FRAGMENT */,
    )
  );
}
__sfc__.render = render;
__sfc__.__file = "src/App.vue";
export default __sfc__;
