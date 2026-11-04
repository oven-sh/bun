// Nothing is added where no parameter is a property: the text has no store that the file lacks.
class Plain { kept = 1; constructor(given: number, other?: string) { this.kept = given; } }
class Signed { constructor(given: number); constructor(given: string); constructor(given: any) { this.held = given; } held: unknown; }
class Silent { static constructor(given: number) { return given; } }
abstract class Drawn { constructor(protected readonly ink: string) {} abstract draw(): string; }
for (const Made of [Plain, Signed, Silent]) console.log(Made.name, String(Made).includes("this.given"), String(Made).includes("given;"));
const evaluate = (text: string): any => (0, eval)("(" + text + ")");
console.log(JSON.stringify(new (evaluate(String(Plain)))(4)), JSON.stringify(new (evaluate(String(Signed)))("s")), evaluate(String(Silent)).constructor(5), JSON.stringify(new (evaluate(String(Drawn)))("blue")));
