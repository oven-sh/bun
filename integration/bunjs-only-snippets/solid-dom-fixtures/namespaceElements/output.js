import { template as _$template } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";

const _tmpl$ = /*#__PURE__*/ _$template(`<namespace:tag></namespace:tag>`, 2);

const template = _$createComponent(module.A, {});

const template2 = _$createComponent(module.a.B, {});

const template3 = _$createComponent(module.A.B, {});

const template4 = _$createComponent(module["a-b"], {});

const template5 = _$createComponent(module["a-b"]["c-d"], {});

const template6 = _tmpl$.cloneNode(true);
