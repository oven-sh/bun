// what the entry of an executable exports has not escaped where no file imports the entry and nobody can ask the loader by a name: its types are proven
// STATISTIC: AccessesUnknown = 0
// STATISTIC: AccessesGuarded = 0
export class Folder {
  constructor(
    public name: string,
    public inner: Folder | null,
  ) {}
}
export function pathOf(folder: Folder): string {
  return folder.inner ? pathOf(folder.inner) + "/" + folder.name : folder.name;
}
console.log(pathOf(new Folder("leaf", new Folder("root", null))));
