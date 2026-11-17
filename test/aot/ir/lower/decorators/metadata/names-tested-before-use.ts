// RUN(NAME): lower
// NAME-LABEL: function {{*}}kind=Module
// NAME: [[tested]] = CheckInitialized {{*}}name="Imported"
// NAME: [[test]] = TypeTest [[tested]] testedType=undefined
// NAME: Branch [[test]] -> taken
// NAME: [[global]] = PropGet {{*}}key="Object" [isFreeName]
// NAME: [[object]] = Convert [[global]] declared={type=builtin(Object) flags=[IsExpected]}
// NAME: Jump -> next [[join]]([[object]])
// NAME: [[imported]] = CheckInitialized {{*}}name="Imported"
// NAME: Jump -> next [[join]]([[imported]])
// NAME: [[join]]([[type]]):
// NAME: [[define]] = Builtin builtin=CompilerHelpersDefineMetadata
// NAME: = Call [[define]], -, {{*}}, [[type]] @
// NAME: = String string="p"

// RUN(QUALIFIED): lower
// QUALIFIED-LABEL: function {{*}}kind=Module
// QUALIFIED: = String string="p"
// QUALIFIED: [[root]] = ModuleNamespace
// QUALIFIED: = TypeTest [[root]] testedType=undefined
// QUALIFIED: [[member]] = PropGet {{*}}key="Inner"
// QUALIFIED: = TypeTest [[member]] testedType=undefined
// QUALIFIED: = PropGet {{*}}key="Object" [isFreeName]
// QUALIFIED: [[inner]] = PropGet {{*}}key="Inner"
// QUALIFIED: Jump -> next [[join]]([[inner]])
// QUALIFIED: [[join]]([[type]]):
// QUALIFIED: = String string="q"

import { Imported } from "./imports/models";
import * as ns from "./imports/models";

declare const d: any;

export class C {
  @d p!: Imported;
  @d q!: ns.Inner;
}
