import type { Location } from "./source.ts";

export interface Name {
  readonly text: string;
  readonly location: Location;
}

export interface KindSyntax {
  readonly name: Name;
  readonly role: Name | null;
  readonly element: KindSyntax | null;
  readonly arrayLength: bigint | "lists" | null;
}

export type ValueSyntax =
  | { readonly form: "Bool"; readonly value: boolean; readonly location: Location }
  | { readonly form: "Integer"; readonly value: bigint; readonly location: Location }
  | { readonly form: "Text"; readonly value: string; readonly location: Location }
  | { readonly form: "Names"; readonly names: readonly Name[]; readonly location: Location };

export interface IncludeSyntax {
  readonly declares: "include";
  readonly path: string;
  readonly isAbi: boolean;
  readonly location: Location;
}

export interface ConstantSyntax {
  readonly declares: "constant";
  readonly name: Name;
  readonly value: bigint;
}

export interface HeapSyntax {
  readonly declares: "heap";
  readonly name: Name;
  readonly indexKinds: readonly Name[];
  readonly marks: readonly Name[];
}

export interface NamedEffectsSyntax {
  readonly declares: "effects";
  readonly name: Name;
  readonly effects: EffectsSyntax;
}

export interface NamedUsesSyntax {
  readonly declares: "uses";
  readonly name: Name;
  readonly uses: readonly UseSyntax[];
}

export interface ParameterGroupSyntax {
  readonly declares: "parameters";
  readonly name: Name;
  readonly parameters: readonly ParameterSyntax[];
}

export interface OpaqueSyntax {
  readonly declares: "opaque";
  readonly names: readonly Name[];
  readonly marks: readonly Name[];
}

export interface ExternalSyntax {
  readonly declares: "external";
  readonly name: Name;
  readonly form: Name;
  readonly isEngine: boolean;
  readonly cppType: string;
  readonly rustPath: string | null;
  readonly members: readonly Name[];
  readonly below: string | null;
  readonly isNamedInText: boolean;
}

export interface ColumnDeclarationSyntax {
  readonly name: Name;
  readonly kind: Name;
}

export interface MemberSyntax {
  readonly name: Name;
  readonly isEngine: boolean;
  readonly values: readonly ValueSyntax[];
}

export interface EnumSyntax {
  readonly declares: "enum" | "flags";
  readonly name: Name;
  readonly isAbi: boolean;
  readonly columns: readonly ColumnDeclarationSyntax[];
  readonly members: readonly MemberSyntax[];
}

export interface ExtendSyntax {
  readonly declares: "extend";
  readonly target: Name;
  readonly source: Name;
  readonly suffix: Name;
  readonly column: Name;
}

export interface FieldSyntax {
  readonly name: Name;
  readonly kind: KindSyntax;
  readonly isOptional: boolean;
  readonly isEngine: boolean;
  readonly isSorted: boolean;
  readonly sortedBy: Name | null;
}

export interface RecordSyntax {
  readonly declares: "record";
  readonly name: Name;
  readonly form: Name;
  readonly marks: readonly Name[];
  readonly fields: readonly FieldSyntax[];
}

export interface CaseSyntax {
  readonly name: Name;
  readonly fields: readonly FieldSyntax[];
}

export interface VariantSyntax {
  readonly declares: "variant";
  readonly name: Name;
  readonly form: Name;
  readonly cases: readonly CaseSyntax[];
}

export interface ListSyntax {
  readonly declares: "list";
  readonly name: Name;
  readonly element: KindSyntax;
  readonly keyword: Name | null;
  readonly prefix: Name | null;
  readonly isSorted: boolean;
  readonly sortedBy: Name | null;
}

export interface TypeWordSyntax {
  readonly word: Name;
  readonly range: readonly [bigint, bigint] | null;
  readonly sameAs: Name | null;
}

export interface TypeSyntax {
  readonly words: readonly TypeWordSyntax[];
  readonly location: Location;
}

export interface NaturalRowSyntax {
  readonly classes: readonly Name[];
  readonly type: TypeSyntax;
}

export interface NaturalSyntax {
  readonly declares: "natural";
  readonly name: Name;
  readonly rows: readonly NaturalRowSyntax[];
  readonly otherwise: TypeSyntax | null;
}

export interface ColumnSyntax {
  readonly declares: "column";
  readonly name: Name;
  readonly kind: Name;
}

export interface ColumnValueSyntax {
  readonly column: Name;
  readonly values: readonly ValueSyntax[];
}

export interface FormRangeSyntax {
  readonly first: Name;
  readonly last: Name;
}

export interface FamilySyntax {
  readonly declares: "family";
  readonly name: Name;
  readonly forms: FormRangeSyntax;
  readonly defaults: readonly ColumnValueSyntax[];
}

export interface ProtocolSyntax {
  readonly name: Name;
  readonly namedMembers: readonly Name[];
}

export interface UseSyntax {
  readonly name: Name;
  readonly operand: Name | null;
  readonly protocols: readonly ProtocolSyntax[];
}

export type ParameterSyntax =
  | { readonly form: "Group"; readonly group: Name }
  | {
      readonly form: "Operand";
      readonly name: Name;
      readonly kind: Name;
      readonly uses: readonly UseSyntax[];
      readonly isOptional: boolean;
      readonly isVariadic: boolean;
      readonly isEngine: boolean;
    }
  | {
      readonly form: "Payload";
      readonly name: Name;
      readonly kind: KindSyntax;
      readonly isOptional: boolean;
      readonly isVariadic: boolean;
      readonly isEngine: boolean;
      readonly firstForm: Name | null;
    };

export interface HeapReferenceSyntax {
  readonly heap: Name;
  readonly indexes: readonly Name[];
}

export type EffectItemSyntax =
  | { readonly form: "Word"; readonly word: Name }
  | { readonly form: "Reads" | "Writes"; readonly heaps: readonly HeapReferenceSyntax[]; readonly location: Location };

export interface EffectsSyntax {
  readonly items: readonly EffectItemSyntax[];
  readonly rule: Name | null;
  readonly location: Location;
}

export interface RuleSyntax {
  readonly rule: Name;
  readonly argument: Name | null;
  readonly contents: Name | null;
  readonly type: TypeSyntax | null;
  readonly indexEnum: Name | null;
  readonly results: readonly ResultSyntax[];
  readonly isOpen: boolean;
}

export interface ResultSyntax {
  readonly unproven: RuleSyntax;
  readonly proven: RuleSyntax | null;
}

export interface FlagSyntax {
  readonly name: Name;
  readonly isEngine: boolean;
}

export interface TargetSyntax {
  readonly name: Name;
  readonly isVariadic: boolean;
  readonly takesProofs: boolean;
  readonly results: readonly ResultSyntax[];
}

export interface EntrySyntax {
  readonly declares: "operation" | "terminator";
  readonly name: Name;
  readonly isEngine: boolean;
  readonly parameters: readonly ParameterSyntax[];
  readonly flags: readonly FlagSyntax[];
  readonly result: ResultSyntax | null;
  readonly targets: readonly TargetSyntax[];
  readonly effects: EffectsSyntax;
  readonly forms: FormRangeSyntax | null;
  readonly columns: readonly ColumnValueSyntax[];
}

export interface RuntimeParameterSyntax {
  readonly type: string;
  readonly name: Name | null;
  readonly location: Location;
}

export interface RuntimeSyntax {
  readonly declares: "runtime";
  readonly names: readonly Name[];
  readonly resultType: string;
  readonly parameters: readonly RuntimeParameterSyntax[];
  readonly effects: EffectsSyntax;
  readonly isLeaf: boolean;
  readonly preservesMost: boolean;
}

export interface InlineEntrySyntax {
  readonly name: Name;
  readonly parameterKinds: readonly Name[];
}

export interface InlineSyntax {
  readonly declares: "inline";
  readonly entries: readonly InlineEntrySyntax[];
  readonly effects: EffectsSyntax;
  readonly family: Name;
  readonly hasOptionalSlowPath: boolean;
  readonly isFormOnly: boolean;
}

export type Declaration =
  | IncludeSyntax
  | ConstantSyntax
  | HeapSyntax
  | NamedEffectsSyntax
  | NamedUsesSyntax
  | ParameterGroupSyntax
  | OpaqueSyntax
  | ExternalSyntax
  | EnumSyntax
  | ExtendSyntax
  | RecordSyntax
  | VariantSyntax
  | ListSyntax
  | NaturalSyntax
  | ColumnSyntax
  | FamilySyntax
  | EntrySyntax
  | RuntimeSyntax
  | InlineSyntax;

export interface ParsedFile {
  readonly path: string;
  readonly isAbi: boolean;
  readonly declarations: readonly Declaration[];
}
