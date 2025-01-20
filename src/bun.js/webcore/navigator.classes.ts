import { define } from "../../codegen/class-definitions";

export default [
  define({
    name: "Navigator",
    construct: true,
    klass: {},
    JSType: "0b11101110",
    proto: {
      hardwareConcurrency: { getter: "get_hardwareConcurrency", setter: "set_noop" },
      language: { getter: "get_language", setter: "set_noop" },
      languages: { getter: "get_languages", setter: "set_noop" },
      platform: { getter: "get_platform", setter: "set_noop" },
      userAgent: { getter: "get_userAgent", setter: "set_noop" },
    },
  }),
];
