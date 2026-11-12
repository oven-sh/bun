// So does a member of an enumeration.
enum Part {
  constructor,
}
const key = Part[0];
const pick = (holder: any, key: string) => holder[key];
