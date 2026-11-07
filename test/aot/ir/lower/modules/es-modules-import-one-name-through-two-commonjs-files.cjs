// RUN(VARIABLES): link
// VARIABLES: variable [[live]] name="level" module=[[gauge]] declared={type=anything} initialization=Undefined
// VARIABLES: variable [[ofGauge]] name="level" module=[[gaugeFace]] declared={type=anything|absent}
// VARIABLES-NEXT: variable [[ofDoor]] name="level" module=[[doorFace]] declared={type=anything|absent}
// VARIABLES-NEXT: module [[gauge]] path="{{*}}/imports/copies/gauge.cjs"
// VARIABLES-NEXT: module [[gaugeFace]] path="#{{*}}" displayPath="imports/copies/gauge.cjs" {{*}}requests=[{target=[[gauge]] kind=Require completes=true}]
// VARIABLES: module [[door]] path="{{*}}/imports/copies/door.cjs"
// VARIABLES-NEXT: module [[doorFace]] path="#{{*}}" displayPath="imports/copies/door.cjs" {{*}}requests=[{target=[[door]] kind=Require completes=true}]
// VARIABLES: EvaluateModule module=[[gauge]] referrer=[[gaugeFace]] [isBare]
// VARIABLES-NEXT: [[atFirstLink]] = GetModuleVariable variable=[[live]]
// VARIABLES-NEXT: PutModuleVariable [[atFirstLink]] variable=[[ofGauge]]
// VARIABLES: function {{*}}name="readFirst"
// VARIABLES: = GetModuleVariable variable=[[ofGauge]]
// VARIABLES: EvaluateModule module=[[door]] referrer=[[doorFace]] [isBare]
// VARIABLES-NEXT: [[atSecondLink]] = GetModuleVariable variable=[[live]]
// VARIABLES-NEXT: PutModuleVariable [[atSecondLink]] variable=[[ofDoor]]
// VARIABLES: function {{*}}name="readSecond"
// VARIABLES: = GetModuleVariable variable=[[ofDoor]]

// A function of gauge.cjs stores `level` again, so an ES importer holds what the name was when the file that shows it was linked. door.cjs shows the name by a getter and is linked at a time of its own:
// its face takes a copy of its own of what the getter returns then, stores into no copy of gauge.cjs, and does not run the face of gauge.cjs.
const first = require("./imports/copies/first.mjs");
first.poke();
const second = require("./imports/copies/second.mjs");
console.log(first.readFirst(), second.readSecond());
