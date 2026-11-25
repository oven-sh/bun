export enum Assigned { One = 1, Two }
export enum Bracketed { One = "one", Two = "two" }
export enum Keyed { One = 1, Two }
export enum Stepped { One = 1, Two }
export enum Deleted { One = 1, Two }
export enum Destructured { One = 1, Two }
export enum Merged { One = 1, Two }
export enum Defined { One = 1, Two }
export enum Aliased { One = 1, Two }
export enum Passed { One = 1, Two }
export enum PassedOn { One = 1, Two }
export enum Looped { One = 1, Two }
export enum Renamed { One = 1, Two }
export enum OffNamespace { One = 1, Two }
export enum OffExportedNamespace { One = 1, Two }
export enum Extended { One = 1, Two }
export enum Untouched { One = 1, Two }
export enum Held { One = 1, Two }
export enum Copied { One = Assigned.One, Two = Untouched.Two }
export function own() {
  return [Assigned.One, Bracketed.One, Merged.One].join();
}
