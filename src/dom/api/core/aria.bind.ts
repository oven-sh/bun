// https://w3c.github.io/aria/#ARIAMixin
import * as b from "../../../codegen/bindgen-lib.ts";
import { DomElement } from "./core.bind.ts";
import { ReflectAria } from "./reflect.bind.ts";
import { nullable, reference, references, reflect } from "./reflect.ts";

export default b.module({ rustPath: "crate::api::core::reflect", feature: "Desktop", isCold: true });

const aria = (names: string, suffix: string, member: (attribute: string) => any) =>
  Object.fromEntries(names.split(/\s+/).map(it => [`aria${it}${suffix}`, member("aria-" + it.toLowerCase())]));

export const ARIAMixin = b.partial("ARIAMixin", {
  on: DomElement,
  proto: {
    role: nullable("role"),
    ...aria(
      `Atomic AutoComplete BrailleLabel BrailleRoleDescription Busy Checked ColCount ColIndex ColIndexText ColSpan
      Current Description Disabled Expanded HasPopup Hidden Invalid KeyShortcuts Label Level Live Modal MultiLine
      MultiSelectable Orientation Placeholder PosInSet Pressed ReadOnly Relevant Required RoleDescription RowCount
      RowIndex RowIndexText RowSpan Selected SetSize Sort ValueMax ValueMin ValueNow ValueText`,
      "",
      () => ReflectAria.of(),
    ),
    ...aria("ActiveDescendant", "Element", reference),
    ...aria("Controls DescribedBy Details ErrorMessage FlowTo LabelledBy Owns", "Elements", references),
    ...reflect("elementTiming"),
  },
});
