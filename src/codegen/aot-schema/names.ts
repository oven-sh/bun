// As JavaScriptCore/aot/ir/generator/names.ts spells them.
function isUpper(character: string): boolean {
  return character >= "A" && character <= "Z";
}

function isLower(character: string): boolean {
  return character >= "a" && character <= "z";
}

function isDigit(character: string): boolean {
  return character >= "0" && character <= "9";
}

export function lowerFirst(name: string): string {
  return name.slice(0, 1).toLowerCase() + name.slice(1);
}

function snakeCase(name: string): string {
  let result = "";
  for (let index = 0; index < name.length; index += 1) {
    const character = name[index];
    const previous = index > 0 ? name[index - 1] : "";
    const next = index + 1 < name.length ? name[index + 1] : "";
    const startsWord = isLower(previous) || isDigit(previous) || (isUpper(previous) && isLower(next));
    if (isUpper(character) && startsWord) result += "_";
    result += character.toLowerCase();
  }
  return result;
}

export function screamingCase(name: string): string {
  return snakeCase(name).toUpperCase();
}
