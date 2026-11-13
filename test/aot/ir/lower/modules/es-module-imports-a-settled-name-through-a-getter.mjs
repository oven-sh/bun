// RUN(READ): link
// READ: variable [[live]] name="width" module=[[fixed]] declared={type=anything} initialization=Undefined
// READ-NEXT: module [[fixed]] path="{{*}}/imports/copies/fixed.cjs"
// READ: function {{*}}name="readWidth"
// READ: [[read]] = GetModuleVariable variable=[[live]]
// READ: Return

// RUN(NOWHERE): link
// NOWHERE-NOT: path="#
// NOWHERE-NOT: declared={type=anything|absent}
// NOWHERE-NOT: CheckInitialized {{*}}name="width"

// Every run of fixed.cjs stores `width` once, and nothing stores it later: what the getter of fixed-door.cjs answers at the link is what the variable holds ever after. The importer reads the variable, and no file has a facade.
import { width } from "./imports/copies/fixed-door.cjs";
export function readWidth() {
  return width;
}
