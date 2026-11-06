// Where programs come from. A source turns a seed into a program for a bed, or into nothing when the seed gives none.
//
//   mutation    a program of ../programs with something done to it (mutate.ts)
//   grammar     a program built from a pool of language features (grammar.ts)
//   protocols   a protocol, a holder, a way to escape and a time, crossed (protocols.ts)
//   new-targets a base constructor, a way another new.target reaches it, what it does with `this`, crossed (new-targets.ts)
//   object-mutations a kind of object, a change of it, when and where the change runs, how the object is looked at, crossed (object-mutations.ts)
//   typed-object-mutations the same in TypeScript that the checker accepts: the object is looked at through a reference of a declared type (typed-object-mutations.ts)
//   changing-buffers a typed array, a DataView or a Buffer whose memory is detached, shrinks, grows or moves while something reads or writes through it (changing-buffers.ts)
//   many-live-values functions with much control flow and many values of several kinds alive at once (many-live-values.ts)
//   a-throw-at-every-call the same, and each function runs again while its first, second, third .. call that the compiler cannot look through throws (a-throw-at-every-call.ts)
//   values-across-joins values of every width and kind that many paths hand on to one place, behind calls, throws and waits (values-across-joins.ts)
//   operators-at-the-edges small functions of a few operators over integers of 32 bits, wider ones and doubles, run at the ends of their ranges (operators-at-the-edges.ts)
//   objects-across-awaits many async functions in flight at once, each with fresh objects that nothing holds but the function while it waits (objects-across-awaits.ts)
//   every-kind-of-job handlers of promises, async functions, async generators, microtasks and timers, each with fresh objects that nothing else holds, running long beside a large heap (every-kind-of-job.ts)
//   work-on-the-way-up recursion of every kind to the end of the stack, caught at every depth on the way up, with calls into the library and allocation in each catch and finally (work-on-the-way-up.ts)
//   when-the-heap-is-full objects of every kind kept alive until no more fit, the error caught at every level on the way up, a little given back and work done there (when-the-heap-is-full.ts)
//   held-by-one-thing-alone an object that one thing alone holds, a collection, and weak references and a finalizer that tell whether the collector saw that one thing (held-by-one-thing-alone.ts)
//   errors-nobody-catches errors and rejections of every kind that nobody catches, one after the other, heard by the handlers of the process or by nobody, and work behind each (errors-nobody-catches.ts)
//   shapes-that-die-and-come-again the same places in the code see objects of shapes that are made, die in a collection and are made again a little differently (shapes-that-die-and-come-again.ts)
//   workers-ended-in-the-middle a Worker that is busy without end in compiled code is ended from outside, or ends itself from deep inside; each program has a build to itself (workers-ended-in-the-middle.ts)
//   calls-with-very-many-arguments calls whose arguments are counted at run time, from none to more than any stack holds, at the top of the stack and at every level on the way up from its end (calls-with-very-many-arguments.ts)
//   text-beside-compiled-code text that becomes code at run time reads and changes objects that compiled code made, and makes objects for compiled code (text-beside-compiled-code.ts)
//   unsound-types a hole of TypeScript's type system that needs no cast, a type, a value that arrives, a place, a time and uses, drawn at random (unsound-types.ts)
//   typed-instances-changed-through-built-ins an instance of a typed class, and one way in which a built-in, a protocol or a callback changes it or makes another object that passes for one (typed-instances-changed-through-built-ins.ts)
//   several-changes-one-behind-the-other two to four points of object-mutations on one object, in a drawn order, and two looks at what is left (several-changes-one-behind-the-other.ts)
//   objects-with-very-many-fields objects with thirty to three hundred members, read by name, key and symbol, directly and from below through a chain of prototypes, around a change (objects-with-very-many-fields.ts)
//   one-name-for-many-kinds-of-things a name that holds something that can be called, a record without a class and a thing with a fast form, used by element, name, call and walk (one-name-for-many-kinds-of-things.ts)
//   objects-that-the-host-keeps-and-hands-back an object handed to a timer, a promise, an event, a signal, a stream, a socket or a file, changed turns of the event loop later, and read again by its maker (objects-that-the-host-keeps-and-hands-back.ts)
//   one-key-asked-in-every-way a key and a value of every kind, asked by a read, `in`, Object.hasOwn, stores, a delete, a call and patterns, one behind the other (one-key-asked-in-every-way.ts)
//   bodies-in-every-encoding-read-as-json bytes that are JSON, nearly JSON or no UTF-8, held by a Request, a Response, a Blob or a stream, read by json() into declared types, into unknown, and by hand (bodies-in-every-encoding-read-as-json.ts)
//   closures-read-through-array-methods closures over the variables of one turn of a loop or of an array method, read through array methods that follow one another (closures-read-through-array-methods.ts)
//   objects-that-live-for-one-turn-of-a-loop objects, lists, instances, closures and shared variables made anew in each turn and used inside the function that makes them (objects-that-live-for-one-turn-of-a-loop.ts)
//   read-by-the-last-holder-while-others-are-made a thing whose parts lie outside of it, read on every turn of a loop by the only one that still holds it, while the same turn makes other things (read-by-the-last-holder-while-others-are-made.ts)
//   instances-below-built-in-classes-frozen-closed-and-redefined instances of classes below Map, Set, Array, Error and two dozen more, with declared fields, frozen, sealed, closed, redefined and given another prototype in typed code (instances-below-built-in-classes-frozen-closed-and-redefined.ts)
//   code-the-build-never-saw-changes-what-it-is-handed the program writes a file when it runs, loads it by a path that only the run knows, and hands it what compiled code holds; each program has a build to itself (code-the-build-never-saw-changes-what-it-is-handed.ts)
//   lists-of-numbers-through-one-map-or-filter a list of numbers goes through one map, filter, flatMap or Array.from in code that runs often, and other kinds of numbers come than the first turns showed (lists-of-numbers-through-one-map-or-filter.ts)
//   loops-whose-tests-are-settled-on-the-first-turn a counter that starts at a written number, a test of it, and behind the test a read that something in the loop may store to (loops-whose-tests-are-settled-on-the-first-turn.ts)
//   loops-over-variables-of-enclosing-code a loop reads and stores variables of its module, of the functions around it and of the turns of a loop around it, while a callee, a closure made in the loop, an accessor, a callback of a built-in, a step of a generator or what runs at an await reads and stores them too (loops-over-variables-of-enclosing-code.ts)
//   what-a-callback-declares-however-it-reaches-a-built-in closures, functions, classes and objects declared in a callback that a built-in runs for each element, the callback handed over as a method's argument or through call, apply, Reflect.apply, bind and functions that hand it on (what-a-callback-declares-however-it-reaches-a-built-in.ts)
//   tests-that-ask-which-runtime-this-is typeof Bun, globalThis.Bun, process.versions.bun and their kin, about the global or about a name of the program's own, held in variables that are read ahead of and behind their initializers (tests-that-ask-which-runtime-this-is.ts)
//   what-a-function-declares-however-often-call-and-apply-enter-it closures, functions, classes and objects declared in a function that call, apply or Reflect.apply enters, where the one place that enters it runs again or another door leads into the same function (what-a-function-declares-however-often-call-and-apply-enter-it.ts)
//   every-birth-and-use the programs of ./generators/births-and-uses, of which the tests run one in forty: all of them, one after the other
//   programs-as-they-are the programs of ../programs unchanged, one after the other: for lanes that change what is built beside a program (--company) or how it is built (--lowered-limits)
//   programs-in-random-order the same programs, each drawn by its seed alone: the programs of one batch come from anywhere in ../programs, so a shared build joins programs that never stand side by side
//   several-changes-behind-a-declared-type the same out of typed-object-mutations, looked at through the typed reference (several-changes-behind-a-declared-type.ts)
//   counters-handed-to-the-one-call-in-a-loop a loop's counter, from small numbers to the ends of the 32 and the 53 bits, halves, -0 and NaN, handed in each turn to the only call of a function that is small or large and may write to the counter, the bound or the step (counters-handed-to-the-one-call-in-a-loop.ts)
//   makers-of-makers-each-with-a-prototype-of-its-own one function makes a prototype object and a maker of objects below it and is called one to forty times, at the top level and elsewhere; the prototypes are changed, frozen, swapped, and the program asks which of them, of the makers and of the methods are the same (makers-of-makers-each-with-a-prototype-of-its-own.ts)
//   holders-with-the-same-keys-and-one-stranger two or three `{ id, part }` literals whose parts are of different classes: one meets a single plain record, the others meet objects without a layout of their own
//   strangers-where-a-type-names-a-class a hot loop reads a member of a field whose type names a class; instances arrive, then records with a field of that name, classes below and beside, objects without a prototype, proxies, null, by stores under unknown keys and casts (strangers-where-a-type-names-a-class.ts)
//   names-asked-of-full-tables-and-texts-converted-again objects that keep a table of their names, from nearly empty to full of deleted places, asked by read, in, hasOwn, store and delete while they grow and shrink; hundreds of lasting texts whose lower and upper case forms are asked for again and again (names-asked-of-full-tables-and-texts-converted-again.ts)
//   names-given-by-key-with-something-done-in-between objects of many births are given one to eleven hundred names by key, most of them literal texts that are another one in each turn; between two such stores a name is defined anew or deleted, the object is closed or put below a String object, a typed array, a proxy; then a collection; also stores by index below those
//   arrays-shifted-during-gc arrays that had elements inserted or removed at the front are read, written, swapped, sorted and resized while garbage keeps the collector running
//   text-written-into-parts-of-views text is encoded into views and into parts of views while the buffers behind them are transferred, resized and collected (text-written-into-parts-of-views.ts)
//   sorts-with-hostile-comparators sort and toSorted of arrays and typed arrays of every kind of element, order and length, with a comparator that answers at random, NaN, one thing always or no number at all, and at one call throws, changes the array, its length or its kind of storage, or sorts it again
//   bind-spread-flatmap-and-boolean-arithmetic bind in a constructor, spreads, flatMap, arithmetic on booleans and getters under computed keys, each many times at one place, with something unusual arriving in the middle
//   prototype-chains-linked-by-hand constructor functions and classes linked by Object.setPrototypeOf, Object.create, __extends or util.inherits, often in a factory that takes the base; in the middle the chain or a method changes
//   built-ins-called-often-through-unknown-values one to five built-ins in one program, each called 1 to 400 times through a value the compiler cannot follow; in the middle that value, the receiver or an operand changes
//   order-of-promise-jobs handlers of then, catch and finally on promises of every state, awaits, microtasks and ticks, some under a store of AsyncLocalStorage: each step writes down its number, and the program prints every order it saw
//   chains-of-awaits-entered-by-the-host chains of async functions that mostly wait for nothing, linked by name, by value, by closures, bound functions, Promise.resolve and then, entered from callbacks of the host: each step writes down its number
//   arrays-grown-from-empty-literals arrays that start as `[]` at one place in the code and grow by a schedule that changes from call to call, filled in a dozen ways, then cut, frozen, given holes or kept
//   closures-in-fields-replaced-from-outside closures kept in fields of classes and object literals, replaced by functions that know nothing about their target, then called, compared and marked through typed readers
//   tail-calls-that-hand-rest-parameters-on functions that end in a call to one another, up to a million calls deep, and hand their rest parameters on: spread, by element, copied, or the array itself
//   host-functions-that-throw native functions of Bun, Node.js and the web called with values they accept and values they refuse, while code of the program runs underneath them
//   keys-of-built-in-objects-after-reads-and-copies the own keys of objects of the language, Bun, Node.js and the web, listed after members were read, asked for, added and deleted and the object was copied
//   keys-of-built-in-objects-that-add-members-when-read the own keys of one built-in object that adds a member when it is first read, listed after members were read, called and asked for, where what is listed could also be something else
//   keys-of-built-in-objects-beside-what-a-compiler-writes-itself the own keys of one built-in object that adds a member when it is first read, listed in a program that uses none, one or all of its members, beside what a compiler writes with built-in functions of its own accord
//   members-of-built-in-objects-handed-around objects and functions of the language, Bun, Node.js and the web, copied or handed through Proxies, revivers, Reflect, collections and closures; then every member is tested, read by name and called
//   closures-tested-before-they-leave a closure is asked something and then returned, stored, thrown, yielded, captured or handed on, under the name that was asked or a second one (closures-tested-before-they-leave.ts)
//   functions-that-make-many-objects-and-return-one one function makes 8 to 148 pairs of small objects, stores into some and returns one, two or a new one (functions-that-make-many-objects-and-return-one.ts)
//   one-name-taken-apart-beside-other-kinds one function takes apart what a variable of type any holds, by a pattern, a spread, a loop or a built-in, and another stores a thing of another kind under that name (one-name-taken-apart-beside-other-kinds.ts)
//   results-of-awaited-steps-used-behind-a-test the result of an awaited step of an async generator, used behind a test of that result: a pattern, `?.`, `== null`, `&&`, typeof (results-of-awaited-steps-used-behind-a-test.ts)
//   lists-made-of-what-is-walked-and-used-on-a-rare-path a function makes a list of what it was handed, by the rest of a pattern, a spread or Array.from, and uses it on a path that seldom runs (lists-made-of-what-is-walked-and-used-on-a-rare-path.ts)
//   strings-grown-piece-by-piece-on-many-paths a string grows piece by piece in a loop and the pieces are appended on more than one path: both arms of a test, a try and its handler, behind a continue; some pieces throw in the middle of an append; some programs run a million turns (strings-grown-piece-by-piece-on-many-paths.ts)
//   compiled-code-calls-text-made-at-run-time compiled code calls functions whose text is made at run time, in every way a function can be called, and that text calls compiled code back: parameters declared, arguments given and locals of the callee are crossed (compiled-code-calls-text-made-at-run-time.ts)
//   long-array-literals-of-mixed-constants an array literal of a few thousand elements of every kind, around the lengths at which a literal may be built in another way, in every place a literal can stand (long-array-literals-of-mixed-constants.ts)
//   very-many-values-alive-across-very-many-blocks one function holds thousands of values at once, each read in a block of its own and used far from where it was made: forward, backward, a while later, round a loop, in a handler; the builds take minutes (very-many-values-alive-across-very-many-blocks.ts)
//   methods-of-helper-objects-define-members-under-written-names a method of a helper object defines a closure on a target under a key it is handed, the calls hand it written names, and the method calls itself or its neighbours in every way (methods-of-helper-objects-define-members-under-written-names.ts)
//   functions-that-keep-very-many-values-alive one function keeps 40 to 5,000 values alive at once, through a loop, into a catch block or over calls that collect, and sums them all (functions-that-keep-very-many-values-alive.ts)
//   a-full-heap-is-let-go-and-built-ins-make-things objects are kept until no more fit, all or half of them are let go, and at once one built-in that makes things is called thousands of times: there is room again, so no call may fail (a-full-heap-is-let-go-and-built-ins-make-things.ts)
//   static-fields-hold-values-outside-their-declared-types a static field of an enum, a union of number literals, or one of these or undefined, null or a string is stored numbers and other values that TypeScript lets in, in every way and place, and read in every way around each store (static-fields-hold-values-outside-their-declared-types.ts)
//   values-that-end-before-a-suspension-beside-values-that-cross-it async functions, generators and async generators hold up to 520 values at once: some are last read before a suspension, others behind it, in a later turn of a loop, in a catch, in a finally, or when the caller throws in or returns (values-that-end-before-a-suspension-beside-values-that-cross-it.ts)
//   tail-calls-between-the-program-and-functions-made-from-text a ring of strict functions, some in the program, some made from text at run time, some behind a Proxy without an apply trap, call one another in tail position in ten forms with fewer, as many or more arguments than the callee names, a hundred thousand times (tail-calls-between-the-program-and-functions-made-from-text.ts)
//   int32-fields-read-under-keys-as-operands fields declared int32 are read with brackets under a key that is one of a few names, a symbol, an enum member, an element of a list of names or a parameter, as operands of operators and built-in functions; the objects come out of JSON.parse and may hold what is no int32 (int32-fields-read-under-keys-as-operands.ts)
//   values-of-another-kind-through-type-parameters a value that is not what the type argument says goes in through `any`, passes through the type parameter by one of seventy roads, is kept in a place whose type says otherwise, a variable that closures share above all, and is used there in up to forty ways (values-of-another-kind-through-type-parameters.ts)
//   values-of-another-kind-behind-a-test a value that is not what the type says reaches a place of a primitive type through `any`, a switch, a comparison, typeof, instanceof, `in`, its truth, `?.` or `??` looks at it there, and what stands behind the test uses it in up to forty ways (values-of-another-kind-behind-a-test.ts)
//   variables-that-never-took-their-class-are-constructed-called-and-extended a variable is meant to take a class and the store never runs (something throws in front of it, its branch is not taken, the class throws while it is defined); what the variable still holds is constructed, called, extended, handed to Reflect.construct and used as a tag, in a try block or not, at the top level, in a function, behind an await or a yield (variables-that-never-took-their-class-are-constructed-called-and-extended.ts)
//   functions-capture-what-is-made-of-a-value-declared-as-another-type a value is declared as an interface that it may not fit (a list, a text, a number, undefined, null, an object of another shape, a function; out of a generic helper, JSON, a cast, a field, a parameter); the program makes something of it (an element, a member, its length, a sum, a spread ..) and an arrow function, a method, a getter, a generator or an async function captures what was made; nobody calls it, the scene does, or somebody outside does (functions-capture-what-is-made-of-a-value-declared-as-another-type.ts)
//   a-class-definition-throws-and-the-program-goes-on something throws while a class is defined or first used (in a static block, a field, a computed key, the heritage, a decorator, a getter, a constructor before or after super()): an undeclared name, a dead zone, a call of what is no function, a thrown value; a try block round the class, at the site or in the caller catches it, or nobody does; a function at the site captures a variable that was never assigned, `this`, a value read from a list or the binding of the class, and the program shows it afterwards (a-class-definition-throws-and-the-program-goes-on.ts)
//   arguments-made-for-a-call-whose-callee-may-return-early a caller makes a rest array, an object literal or an array literal for a call; the callee tests something first and may return, throw or call on before it keeps, changes, returns, spreads, captures or compares that argument
//   functions-handed-to-async-functions-and-used-around-their-awaits a caller hands a closure or a bound function over its own locals to an async function, which calls, keeps, stores, captures, passes on or returns it before and behind its awaits; the caller returns first, the stack is written over and a collection runs before the async function goes on (functions-handed-to-async-functions-and-used-around-their-awaits.ts)
//   functions-that-return-before-they-touch-what-the-caller-made a function takes a rest parameter, or a parameter for which its callers write an object or a list, and may return, throw or go on before it touches it; what stands in front of the first use has effects, what the caller writes has effects too, and the switch that decides turns while the program runs (functions-that-return-before-they-touch-what-the-caller-made.ts)
//   elements-stored-below-an-object-that-intercepts-them lists, objects and instances take elements by index, and at some time an object above them begins to intercept such stores: a Proxy in the chain, a setter or a value that cannot be written under an index; objects are made before and behind that time, collections run in between, classes are made by the hundred (elements-stored-below-an-object-that-intercepts-them.ts)
//   sums-of-whole-numbers-at-the-edges-of-what-a-double-holds loops add and subtract whole numbers at the edges of 31, 32, 52 and 53 bits and cut the sum to 32 bits, to a whole number, or not at all; now and then a field holds what is no whole number (sums-of-whole-numbers-at-the-edges-of-what-a-double-holds.ts)
//   objects-that-may-be-missing-hold-one-another two to four objects, each made under a try of its own, hold one another and something of their own; the last one leaves the function on some ways only (objects-that-may-be-missing-hold-one-another.ts)
//   <any of these>-in-several-files the same program with the declarations at its top laid into up to four further files, which import from each other; in every second program they import from its first file too (declarations-in-files-of-their-own.ts), and in every second typed program some of them are JavaScript, half of these beside a declaration file that says too little: `1` for number, one member of a union; two in five of those files are not valid either, and the program has a tsconfig.json with skipLibCheck; three in five of the files with declarations are packages in node_modules, half of them CommonJS; one in four of the files that stay TypeScript says too little in its own annotations, under @ts-nocheck; in three programs of ten the first file imports through a barrel
//   host-functions-throw-in-code-that-built-ins-call a function of the host or of the language throws inside a getter, a conversion, a callback, a trap, an iterator or a listener that a built-in function has called; the call stands in tail position or not, and the exception is caught in that function, around the built-in function, further up or nowhere (host-functions-throw-in-code-that-built-ins-call.ts)
//   one-call-reaches-either-of-two-built-ins one call reaches either of two built-in functions, however the two arrive there and however they are called, and one thing is done with what it answers (one-call-reaches-either-of-two-built-ins.ts)
//   an-element-is-tested-stored-to-and-read-again-in-one-turn-of-a-loop in one turn of a loop that walks a list an element is tested, an element is stored to and an element is read, most often the same one; the body is small, and every function sees lists made in one way alone (an-element-is-tested-stored-to-and-read-again-in-one-turn-of-a-loop.ts)
//   a-field-of-an-element-is-tested-stored-to-and-read-again-in-one-turn-of-a-loop the same with a field of an element: the field or the element is stored to, through the list, through a name for the row, or through a second name for the list (a-field-of-an-element-is-tested-stored-to-and-read-again-in-one-turn-of-a-loop.ts)
import { existsSync, readdirSync, readFileSync } from "fs";
import { join, relative } from "path";
import { withPackedPrograms } from "../generate";
import { printFor, projects, staysAScript, type Bed, type Program } from "./beds";
import { withCollectionsInsideCalls } from "./collections-inside-calls";
import { withDeclarationsInFilesOfTheirOwn } from "./declarations-in-files-of-their-own";
import { table, whole, type Drawn } from "./family";
import { withFunctionsTheHostCouldCall } from "./functions-the-host-could-call";
import { erased, mutate, reprinted } from "./mutate";
import { Random } from "./random";
import { places, withTheWholeFileInside } from "./the-whole-file-inside-something";
import { withTheWorldOpen } from "./the-world-is-open";
import { withTurnsNobodyKnows } from "./turns-nobody-knows";

export interface Generated extends Program {
  source: string;
  seed: number;
  /** Where it comes from and what was done to it. */
  notes: string;
  /** The program a mutant was made from: if that one differs already, the mutant says nothing. */
  base?: Program & { name: string };
  /** What the program is about. Two programs of different groups that fail with the same words are two findings. */
  group?: string;
  /** Its cases, each as a program of its own that prints the lines it prints in the whole: a finding is cut down to one of them first. */
  alone?: string[];
  /** TypeScript's own checker has to accept it, or it does not count. */
  isForTypeScript?: true;
  /** It is the entry point of its build, never a module of a build that several programs share. */
  standsAlone?: true;
  /** The text that was laid into its files: a finding is tried on that first. */
  inOneFile?: string;
}

export type Source = (seed: number, bed: Bed) => Generated | undefined;

export const inSeveralFiles = "-in-several-files";
export const writtenAgain = "-written-again";

// At the top of a file with an `import`, `this` is null in plain Bun and undefined in an executable; in a file without one it is an object in both. The transpiler knows which `this` stands at the top: in a module it prints null in its place.
function namesThisAtItsTop(text: string, extension: "js" | "ts"): boolean {
  const printer = new Bun.Transpiler({ loader: extension });
  const count = (printed: string) => printed.match(/\bthis\b/g)?.length ?? 0;
  try {
    return (
      count(printer.transformSync(`async function all() {\n${text}\n}`)) >
      count(printer.transformSync(`export {};\n${text}`))
    );
  } catch {
    return false;
  }
}

/** Where what begins at `from` ends: at the bracket that closes the one there, or, for a type, in front of the `{` of a body or the `=` of an initializer. -1 where it does not. */
function endOf(text: string, from: number, what: "bracket" | "{" | "="): number {
  let depth = 0;
  for (let at = from; at < text.length; at++) {
    const char = text[at];
    if (char === '"' || char === "'" || char === "`") {
      at = text.indexOf(char, at + 1);
      if (at < 0) return -1;
    } else if (char === "=" && text[at + 1] === ">") at++;
    else if (depth === 0 && char === what) {
      const before = text.slice(from, at).trimEnd();
      // `{` may also begin a type: at the start, and behind whatever wants a type to follow.
      if (
        what === "=" ||
        (before && !/(?:[|&:,<([]|=>|\b(?:is|extends|keyof|typeof|readonly|asserts|infer|new))$/.test(before))
      )
        return at;
      depth++;
    } else if ("([{<".includes(char)) depth++;
    else if (")]}>".includes(char) && --depth === 0 && what === "bracket") return at;
  }
  return -1;
}

/** A type that holds fewer values than the given one, so that whoever took the given one takes it too. Nothing where no rule fits. */
function narrower(type: string, random: Random): string | undefined {
  const members: string[] = [];
  let from = 0;
  for (let at = 0, depth = 0; at <= type.length; at++) {
    if (at === type.length || (depth === 0 && type[at] === "|"))
      (members.push(type.slice(from, at).trim()), (from = at + 1));
    else if (type[at] === "=" && type[at + 1] === ">") return;
    else if ("([{<".includes(type[at])) depth++;
    else if (")]}>".includes(type[at])) depth--;
  }
  if (members.length > 1) return random.pick(members.filter(Boolean));
  const inPromise = /^Promise<(.+)>$/.exec(type);
  if (inPromise) {
    const inner = narrower(inPromise[1], random);
    return inner && `Promise<${inner}>`;
  }
  const rules: Record<string, string[]> = {
    number: ["1", "0"],
    string: ['"text"', '""'],
    boolean: ["true", "false"],
    unknown: ["number", "string", "{ a: number }", "number[]", "null"],
    any: ["number", "string", "{ a: number }", "number[]", "undefined"],
    object: ["{ a: number }", "number[]"],
    "unknown[]": ["number[]", "string[]", "[number]"],
    "any[]": ["number[]", "string[]", "[number]"],
    "number[]": ["[number]", "1[]", "[]"],
    "string[]": ["[string]", '"text"[]', "[]"],
  };
  return rules[type] && random.pick(rules[type]);
}

/** A declaration file for the text, in which one to three functions and constants are said to give less than they give. Nothing where the text holds a form that is not known here, or nothing to say less about. */
function declarationsThatSayTooLittle(typed: string, random: Random): string | undefined {
  const declared: { text: string; type?: [from: number, to: number] }[] = [];
  for (const unit of typed.split(/\n(?=[^\s})\]])/)) {
    if (/^(?:import|export (?:interface|type))\b/.test(unit)) declared.push({ text: unit.trimEnd() });
    else if (!unit.startsWith("export ")) continue;
    else if (/^export (?:async )?function\b/.test(unit)) {
      const head = /^export (async )?function(\*)? ?[\w$]+/.exec(unit)!;
      const open = unit[head[0].length] === "<" ? endOf(unit, head[0].length, "bracket") + 1 : head[0].length;
      const close = unit[open] === "(" ? endOf(unit, open, "bracket") : -1;
      // A default has no place in a declaration, a pattern says nothing there, and of several signatures the last is not declared.
      if (
        close < 0 ||
        /=(?!>)|(?:^|,)\s*(?:\.\.\.)?[{[]/.test(unit.slice(open + 1, close)) ||
        !unit.startsWith(": ", close + 1)
      )
        return;
      const end = endOf(unit, close + 3, "{");
      if (end < 0 || /\n/.test(unit.slice(0, end))) return;
      // A declaration has no `*`: what the type says is all there is to say.
      const text = `export declare function ${unit.slice(`export ${head[1] ?? ""}function${head[2] ?? ""}`.length, end).trim()};`;
      declared.push({
        text,
        ...(head[2] ? {} : { type: [text.length - 1 - unit.slice(close + 3, end).trimEnd().length, text.length - 1] }),
      });
    } else if (/^export const [\w$]+: /.test(unit)) {
      const from = unit.indexOf(": ") + 2;
      const end = endOf(unit, from, "=");
      if (end < 0) return;
      const text = `export declare const ${unit.slice("export const ".length, end).trimEnd()};`;
      declared.push({ text, type: [text.length - 1 - unit.slice(from, end).trimEnd().length, text.length - 1] });
    } else if (/^export const [\w$]+ = /.test(unit))
      declared.push({ text: `export declare const ${/[\w$]+/.exec(unit.slice(13))![0]}: any;` });
    else if (/^export class [\w$]+ /.test(unit))
      declared.push({
        text: `export declare class ${/[\w$]+/.exec(unit.slice(13))![0]} {\n  constructor(...all: any[]);\n  [member: string]: any;\n  static [member: string]: any;\n}`,
      });
    else return;
  }
  let said = 0;
  for (const each of random.shuffled(declared)) {
    const less = each.type && said < 3 && narrower(each.text.slice(...each.type), random);
    if (!less) continue;
    each.text = each.text.slice(0, each.type![0]) + less + each.text.slice(each.type![1]);
    said++;
  }
  return said ? declared.map(each => each.text + "\n").join("") : undefined;
}

/** Some of the files as JavaScript, their types erased: what the others know about them is inferred, or stands in a declaration file beside them that says too little. A file stays as it is where another one takes a type from it, or where it declares what JavaScript has no word for. */
/** The TypeScript itself says too little: one to three of its exported functions and constants are annotated with less than they give, and `// @ts-nocheck` at its top keeps the checker quiet about it. Nothing where there is nothing to say less about. */
function withAnnotationsThatSayTooLittle(typed: string, random: Random): string | undefined {
  const places: [from: number, to: number][] = [];
  for (const { 0: head, index } of typed.matchAll(/^export (?:(?:async )?function [\w$]+|const [\w$]+: )/gm)) {
    const behind = index + head.length;
    if (head.endsWith(": ")) places.push([behind, endOf(typed, behind, "=")]);
    else {
      const open = typed[behind] === "<" ? endOf(typed, behind, "bracket") + 1 : behind;
      const close = typed[open] === "(" ? endOf(typed, open, "bracket") : -1;
      if (close > 0 && typed.startsWith(": ", close + 1)) places.push([close + 3, endOf(typed, close + 3, "{")]);
    }
  }
  let changed = typed;
  let said = 0;
  // From the last on, so that the places in front stay where they are.
  for (const [from, to] of random
    .sample(
      places.filter(([, to]) => to > 0),
      3,
    )
    .sort((a, b) => b[0] - a[0])) {
    const less = narrower(typed.slice(from, to).trim(), random);
    if (!less) continue;
    changed = `${changed.slice(0, from)}${less} ${changed.slice(to)}`;
    said++;
  }
  return said ? "// @ts-nocheck\n" + changed : undefined;
}

// What a checker reports inside a declaration file and nowhere else. Under `skipLibCheck` nobody hears of it.
const invalidDeclarations: readonly string[] = [
  "export declare const invalidName: Missing;",
  "export declare function invalidResult(value: number): Absent<string>;",
  "export declare const invalidArguments: Date<string>;",
  "export declare const declaredTwice: number;\nexport declare const declaredTwice: string;",
  "export declare class InvalidHeir extends NotDeclared {}",
  "export interface InvalidInterface extends Missing {}",
  "export type InvalidRing = InvalidRing;",
  "export declare function invalidParameter(value: Missing.Inner): void;",
  "export declare const invalidQuery: typeof notDeclared;",
  "export declare let invalidMember: Array<number>.absent;".replace(".absent", '["absent"]'),
];

/** The declarations with one to three more that are not valid, and now and then a result of a type that nobody declares. */
function withInvalidDeclarations(declarations: string, random: Random): string {
  const unknown = random.chance(0.5)
    ? declarations.replace(/^(export declare function [^\n]*\): )[^\n]*;$/m, "$1Missing;")
    : declarations;
  return unknown + random.sample(invalidDeclarations, random.between(1, 3)).map(each => each + "\n").join(""); // prettier-ignore
}

function withSomeFilesInJavaScript(
  text: string,
  files: Record<string, string>,
  random: Random,
): Record<string, string> {
  const all = [text, ...Object.values(files)].join("\n");
  let isInvalid = false;
  const changed = Object.fromEntries(
    Object.entries(files).flatMap(([path, typed]) => {
      const stem = path.replace(/\.ts$/, "");
      const isAsked = random.chance(0.5);
      if (!isAsked || new RegExp(`^import type [^;]*"\\./${stem}"`, "m").test(all)) return [[path, typed]];
      if (/\b(enum|namespace|module|declare|abstract)\b/.test(typed)) return [[path, typed]];
      try {
        const untyped = erased(typed, "ts");
        if (untyped.includes('from "bun:wrap"')) return [[path, typed]];
        const declarations = random.chance(0.5) ? declarationsThatSayTooLittle(typed, random) : undefined;
        if (!declarations) return [[stem + ".js", untyped]];
        if (!random.chance(0.4)) return [[stem + ".js", untyped], [stem + ".d.ts", declarations]]; // prettier-ignore
        isInvalid = true;
        return [[stem + ".js", untyped], [stem + ".d.ts", withInvalidDeclarations(declarations, random)]]; // prettier-ignore
      } catch {
        return [[path, typed]];
      }
    }),
  );
  // The program has a tsconfig.json of its own then, under which declaration files are not checked.
  const own = { compilerOptions: { ...projects["the-bed's-own"].tsconfig!.compilerOptions, skipLibCheck: true } };
  return isInvalid ? { ...changed, "tsconfig.json": JSON.stringify(own) + "\n" } : changed;
}

/** The first file takes what it imports through one more file, which only hands on what the others export: all of a file by a star, or name by name. As it was where the first file imports nothing of them. */
function throughABarrel(text: string, extension: string, random: Random): { text: string; barrel?: string } {
  const handedOn: string[] = [];
  const end = extension === "ts" ? "" : `.${extension}`;
  const changed = text.replace(
    /^import (type )?\{ ([^}]*) \} from ("\.\/declared-\d+(?:\.\w+)?");$/gm,
    (_, type: string | undefined, names: string, from: string) => {
      const star = `export * from ${from};`;
      if (!handedOn.includes(star))
        handedOn.push(random.chance(0.5) ? star : `export ${type ?? ""}{ ${names} } from ${from};`);
      return `import ${type ?? ""}{ ${names} } from "./barrel${end}";`;
    },
  );
  return handedOn.length ? { text: changed, barrel: handedOn.map(line => line + "\n").join("") } : { text };
}

/** An ES module, printed one statement a line, as the CommonJS file that compilers make of it: functions are laid on `exports` at the top, the rest at the end. Nothing where a form is left that has no such spelling. */
function asCommonJS(text: string): string | undefined {
  const functions: string[] = [];
  const names = new Bun.Transpiler({ loader: "js" }).scan(text).exports;
  const body = text
    .replace(
      /^import \{ ([^}]*) \} from ("[^"]*");$/gm,
      (_, taken: string, from: string) => `const { ${taken.replaceAll(" as ", ": ")} } = require(${from});`,
    )
    .replace(
      /^export ((?:async )?function\*? ?([\w$]+))/gm,
      (_, head: string, name: string) => (functions.push(name), head),
    )
    .replace(/^export (?=(?:class|const|let|var) )/gm, "");
  if (/^(?:import|export)\b|\bimport\.meta\b|^await\b|\bfor await\b/m.test(body) || names.includes("default")) return;
  const laidOn = (name: string) => `exports.${name} = ${name};\n`;
  return `"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\n${functions.map(laidOn).join("")}${body}${body.endsWith("\n") ? "" : "\n"}${names.filter(name => !functions.includes(name)).map(laidOn).join("")}`; // prettier-ignore
}

/** Some of the JavaScript that has declarations beside it becomes a package: `node_modules/declared-<n>` with a package.json, imported by its name. A file goes only if all that it imports has gone. */
function withSomeFilesAsPackages(
  text: string,
  files: Record<string, string>,
  random: Random,
): { text: string; files: Record<string, string>; packages: number } {
  const moved: string[] = [];
  for (const path of Object.keys(files)) {
    const stem = /^(declared-\d+)\.js$/.exec(path)?.[1];
    if (!stem || !files[`${stem}.d.ts`] || !random.chance(0.6)) continue;
    const imported = [files[path], files[`${stem}.d.ts`]].flatMap(each => Array.from(each.matchAll(/from "\.\/([\w-]+)(?:\.\w+)?"/g), match => match[1])); // prettier-ignore
    if (imported.every(name => moved.includes(name))) moved.push(stem);
  }
  const byName = (each: string) => each.replace(/(from )"\.\/([\w-]+)(?:\.\w+)?"/g, (whole, from: string, name: string) => (moved.includes(name) ? `${from}"${name}"` : whole)); // prettier-ignore
  const laid: Record<string, string> = {};
  for (const [path, each] of Object.entries(files)) {
    const [, stem, end] = /^(declared-\d+)(\.js|\.d\.ts)$/.exec(path) ?? [];
    laid[moved.includes(stem) ? `node_modules/${stem}/index${end}` : path] = /\.[jt]s$/.test(path)
      ? byName(each)
      : each;
  }
  // Two packages of one name and one version count as one package, and a build may hold many programs.
  for (const name of moved) {
    const index = `node_modules/${name}/index.js`;
    const required = random.chance(0.5) ? asCommonJS(laid[index]) : undefined;
    if (required) laid[index] = required;
    laid[`node_modules/${name}/package.json`] = JSON.stringify({ name, version: `1.0.${Bun.hash.crc32(laid[index])}`, type: required ? "commonjs" : "module", main: "index.js", types: "index.d.ts" }) + "\n"; // prettier-ignore
  }
  return { text: byName(text), files: laid, packages: moved.length };
}

/** A program in one file, laid into several in all the ways above; `notes` says in which. Nothing where it declares too little at its top, or asks there what `this` is. */
export function laidIntoFiles(
  text: string,
  extension: string,
  random: Random,
): { text: string; files: Record<string, string>; notes: string } | undefined {
  const isTyped = extension === "ts";
  if (namesThisAtItsTop(text, isTyped ? "ts" : "js")) return;
  const laid = withDeclarationsInFilesOfTheirOwn(text, extension, random, random.chance(0.5));
  if (!laid) return;
  const files = isTyped && random.chance(0.5) ? withSomeFilesInJavaScript(laid.text, laid.files, random) : laid.files;
  const { text: first, barrel } = random.chance(0.3)
    ? throughABarrel(laid.text, extension, random)
    : { text: laid.text };
  if (barrel) files[`barrel.${extension}`] = barrel;
  const { text: entry, files: all, packages } = withSomeFilesAsPackages(first, files, random);
  let unchecked = 0;
  for (const path of isTyped ? Object.keys(all) : []) {
    const lying =
      /^declared-\d+\.ts$/.test(path) && random.chance(0.25) && withAnnotationsThatSayTooLittle(all[path], random);
    if (lying) (unchecked++, (all[path] = lying));
  }
  const untyped = isTyped ? Object.keys(files).filter(path => path.endsWith(".js")).length : 0;
  const declared = Object.keys(files).filter(path => path.endsWith(".d.ts")).length;
  const isUnchecked = "tsconfig.json" in files;
  return {
    text: entry,
    files: all,
    notes: `${Object.keys(files).length + 1 - declared - Number(isUnchecked)} files${untyped ? `, ${untyped} in JavaScript` : ""}${declared ? `, ${declared} of them beside declarations that say too little${isUnchecked ? " and are not valid, under skipLibCheck" : ""}` : ""}${barrel ? ", one a barrel" : ""}${packages ? `, ${packages} as packages` : ""}${unchecked ? `, ${unchecked} with annotations that say too little, under @ts-nocheck` : ""}`,
  };
}

/** The programs of a source, each in several files. */
const laidIntoSeveralFiles =
  (source: Source): Source =>
  (seed, bed) => {
    if (!bed.takesSeveralFiles) return;
    const whole = source(seed, bed);
    if (!whole || whole.files) return;
    // `print` is a declaration like the others: it lies in one file and the rest import it.
    const isWithoutPrint = /\bprint\(/.test(whole.text) && !/\b(function|const|let|var) print\b/.test(whole.text);
    const text = isWithoutPrint ? printFor(whole.extension === "ts") + whole.text : whole.text;
    // Many a source takes the lowest bit of the seed for "typed".
    const laid = laidIntoFiles(text, whole.extension, new Random(new Random(seed).next() ^ 0x2f11e5));
    if (!laid) return;
    const { alone, ...rest } = whole;
    return {
      ...rest,
      text: laid.text,
      files: laid.files,
      source: whole.source + inSeveralFiles,
      inOneFile: text,
      notes: `${whole.notes} | ${laid.notes}`,
    };
  };

/**
 * The programs of a source, each written again in one to six ways after which it prints what it printed before and the compiler knows less about it: what it works on has come back from
 * text that no build knows, the bounds of its short loops hang on the run, each function begins with a call that collects now and then, the host could call what it declares, its world is
 * open, the whole file stands inside a function, a try or a loop.
 */
const writtenOnceMore =
  (source: Source): Source =>
  (seed, bed) => {
    if (bed.name !== "product") return;
    const whole = source(seed, bed);
    if (!whole || whole.files || (whole.extension !== "ts" && whole.extension !== "js")) return;
    const loader = whole.extension;
    const random = new Random(new Random(seed).next() ^ 0x51ab07);
    const place = places[random.between(0, places.length - 1)];
    // It reads the program with the TypeScript package, which is loaded only where this form is drawn.
    const { laundered, whatIsLaundered } =
      require("./what-a-program-works-on-comes-back-from-text-nobody-knows") as typeof import("./what-a-program-works-on-comes-back-from-text-nobody-knows");
    const what = whatIsLaundered[random.between(0, whatIsLaundered.length - 1)];
    const ways: [name: string, write: (text: string) => string][] = [
      [`${what} come back from text nobody knows`, text => laundered(`main.${loader}`, text, what, random) ?? text],
      ["turns nobody knows", withTurnsNobodyKnows],
      ["collections inside calls", text => withCollectionsInsideCalls(text, loader)],
      ["functions the host could call", text => withFunctionsTheHostCouldCall(text, loader)],
      ["the world is open", withTheWorldOpen],
      [`the whole file inside ${place}`, text => withTheWholeFileInside(text, loader, place)],
    ];
    let text = whole.text;
    const taken: string[] = [];
    for (const [name, write] of ways) {
      if (!random.chance(0.4)) continue;
      const written = write(text);
      if (written !== text) taken.push(name);
      text = written;
    }
    if (!taken.length) return;
    const { alone, ...rest } = whole;
    return {
      ...rest,
      text,
      source: whole.source + writtenAgain,
      notes: `${whole.notes} | ${taken.join(", ")}`,
      // An open world makes one program of all that is built together.
      standsAlone: true,
    };
  };

/** The programs in a single file that print the same compiled and plain, with nothing stored beside them. */
function singleFilePrograms(root: string) {
  const found: string[] = [];
  const stored = [".json", ".expected.txt", ".erased.txt", ".build-errors.txt", ".todo.txt"];
  const visit = (folder: string) => {
    const entries = readdirSync(folder, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
    if (entries.some(entry => entry.isFile() && entry.name.startsWith("main."))) return;
    const names = new Set(entries.map(entry => entry.name));
    for (const entry of entries) {
      if (entry.isDirectory()) entry.name === "ways-into-library-modules" || visit(join(folder, entry.name));
      else if (/\.(ts|js)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
        const stem = entry.name.replace(/\.\w+$/, "");
        if (!stored.some(suffix => names.has(stem + suffix))) found.push(join(folder, entry.name));
      }
    }
  };
  if (existsSync(root)) visit(root);
  return withPackedPrograms(root, found, /(?<!\.d)\.(ts|js)$/, stored);
}

// Depends on where the file lies, on the clock or on chance, prints what differs by design (positions, source text), or has what it prints written at its end: it differs from plain Bun on purpose.
const cannotStandAlone =
  /from "\.|require\("\.|import\("\.|import\.meta|__dirname|__filename|process\.argv|\bprocess\b.*\bconsole\.log\(process\)|Bun\.main|\.stack\b|Date\.now|performance\.now|Math\.random|new Date\(\)|\.toString\(\)\.length|\.caller\b|getBuiltinModule|mkdtemp|hrtime|[cC]puUsage|memoryUsage|resourceUsage|randomUUID|randomBytes|getRandomValues|port: 0|listen\(0|\n\/\* (Output|Build errors):/;

function mutation(root: string, rejected: Set<string>): Source | undefined {
  const { paths: files, textOf } = singleFilePrograms(root);
  if (!files.length) return;
  const printed = new Map<string, string | undefined>();
  // The program as it is (typed), or erased to JavaScript and printed one statement per line.
  const baseText = (path: string, typed: boolean) => {
    const key = `${path} ${typed}`;
    if (printed.has(key)) return printed.get(key);
    let text: string | undefined = textOf(path);
    if (text.length > 12_000 || cannotStandAlone.test(text)) text = undefined;
    try {
      if (text !== undefined && !typed) text = erased(text, path.endsWith(".ts") ? "ts" : "js");
      // The transpiler lowers some syntax to helpers of Bun's own runtime module, which no program imports by hand.
      if (text?.includes('from "bun:wrap"')) text = undefined;
    } catch {
      text = undefined;
    }
    printed.set(key, text);
    return text;
  };
  return (seed, bed) => {
    const random = new Random(seed);
    for (let attempt = 0; attempt < 40; attempt++) {
      const path = random.pick(files);
      const typed = path.endsWith(".ts") && bed.name === "product" && random.chance(0.5);
      const name = `${bed.name} ${relative(root, path)}${typed ? "" : " erased"}`;
      if (rejected.has(name)) continue;
      const base = baseText(path, typed);
      const extension = typed ? "ts" : "js";
      if (base === undefined || !bed.accepts({ text: base, extension })) {
        rejected.add(name);
        continue;
      }
      const mutant = mutate(base, random, typed, { allows: text => bed.allows(text) });
      if (mutant)
        return {
          source: "mutation",
          seed,
          text: typed ? mutant.text : reprinted(mutant.text),
          extension,
          notes: `${name}: ${mutant.applied.join(", ")}`,
          base: { name, text: base, extension },
        };
    }
  };
}

function asTheyAre(root: string, source: string, pick: (seed: number, count: number) => number): Source | undefined {
  const { paths: files, textOf } = singleFilePrograms(root);
  if (!files.length) return;
  return (seed, bed) => {
    if (bed.name !== "product") return;
    const path = files[pick(seed, files.length)];
    const text = textOf(path);
    if (text.length > 60_000 || cannotStandAlone.test(text)) return;
    return {
      source,
      seed,
      text: path.endsWith(".js") && !/^(import|export)\b/m.test(text) ? staysAScript + text : text,
      extension: path.endsWith(".ts") ? "ts" : "js",
      notes: relative(root, path),
    };
  };
}

function everyBirthAndUse(): Source | undefined {
  const folder = join(import.meta.dir, "generators", "births-and-uses");
  if (!existsSync(folder)) return;
  const names = readdirSync(folder)
    .filter(
      name =>
        name.endsWith(".ts") &&
        !["run.ts", "also-with-types-erased.ts", "where-a-stretch-stands.ts"].includes(name) &&
        !(process.env.AOT_FUZZ_BIRTHS_WITHOUT ?? "").split(",").includes(name),
    )
    .sort();
  const differs = new Set(
    Object.values(
      JSON.parse(readFileSync(join(folder, "known-to-differ.json"), "utf8")) as Record<string, Record<string, string>>,
    ).flatMap(Object.keys),
  );
  const tables = new Map<string, { name: string; file: string; text: string; flags?: string[] }[]>();
  return (seed, bed) => {
    if (bed.name !== "product") return;
    const from = names[seed % names.length];
    const typed = Math.floor(seed / names.length) % 2 === 1;
    const key = from + typed;
    if (!tables.has(key)) tables.set(key, require(join(folder, from)).programs(typed));
    const table = tables.get(key)!;
    if (!table.length) return;
    // Neighbours in a table differ in one part: a stride that shares no factor with most lengths takes a batch from all over it.
    const { name, file, text, flags } = table[(Math.floor(seed / (names.length * 2)) * 7919) % table.length];
    if (flags?.length || differs.has(name) || text.length > 60_000) return;
    const program: Program = { text, extension: file.endsWith(".ts") ? "ts" : "js" };
    return bed.accepts(program) && bed.allows(text)
      ? { source: "every-birth-and-use", seed, ...program, notes: `${from} ${name}`, group: from }
      : undefined;
  };
}

type Generator = (random: Random, typed: boolean, profile: { library: boolean }) => string;

// A module of this folder is loaded when a program is first drawn from it: a run that draws from a few sources loads a few, and holds no table of the others.
const generateOf =
  (name: string) =>
  (...given: unknown[]) =>
    require(`./${name}.ts`).generate(...given);
const tableOf = (name: string) => ({
  get programs(): number {
    return require(`./${name}.ts`).programs;
  },
  programOf: (index: number) => require(`./${name}.ts`).programOf(index),
  flagsOf: (index: number) => require(`./${name}.ts`).flagsOf?.(index),
});

const generated =
  (source: string, generate: Generator): Source =>
  (seed, bed) => {
    const random = new Random(seed);
    if (source === "many-of-one-thing" && bed.name !== "product") return;
    if (
      (source === "typed-object-mutations" ||
        source === "held-across-suspensions" ||
        source === "where-the-stack-ends" ||
        source === "changing-buffers" ||
        source === "many-live-values" ||
        source === "a-throw-at-every-call" ||
        source === "values-across-joins" ||
        source === "operators-at-the-edges" ||
        source === "objects-across-awaits" ||
        source === "every-kind-of-job" ||
        source === "work-on-the-way-up" ||
        source === "text-beside-compiled-code") &&
      bed.name !== "product"
    )
      return;
    const typed =
      source === "typed-object-mutations" ||
      source === "held-across-suspensions" ||
      source === "where-the-stack-ends" ||
      source === "changing-buffers" ||
      source === "many-live-values" ||
      source === "a-throw-at-every-call" ||
      source === "values-across-joins" ||
      source === "operators-at-the-edges" ||
      source === "objects-across-awaits" ||
      source === "every-kind-of-job" ||
      source === "work-on-the-way-up" ||
      source === "text-beside-compiled-code" ||
      (source === "grammar" && bed.name === "product" && random.chance(0.5));
    const program: Program = {
      text: generate(random, typed, { library: bed.name === "product" }),
      extension: typed ? "ts" : "js",
    };
    return bed.accepts(program) && bed.allows(program.text)
      ? { source, seed, ...program, notes: typed ? "typed" : "untyped" }
      : undefined;
  };

// A program that starts itself again as a Worker names its own file. One that loads code which the build never saw changes what the compiler may take for granted about everything built beside it.
const standAlone = new Set([
  "workers-ended-in-the-middle",
  "code-the-build-never-saw-changes-what-it-is-handed",
  "lists-of-numbers-through-one-map-or-filter",
  "loops-whose-tests-are-settled-on-the-first-turn",
]);
const flagsOfSource: Record<string, string[]> = {
  "code-the-build-never-saw-changes-what-it-is-handed": ["--aot-allow-code-from-disk"],
};

/** A source that writes TypeScript, for the product alone. */
const typedForTheProduct =
  (source: string, generate: Generator): Source =>
  (seed, bed) => {
    if (bed.name !== "product") return;
    const program: Program = {
      text: generate(new Random(seed), true, { library: true }),
      extension: "ts",
      ...(flagsOfSource[source] ? { flags: flagsOfSource[source] } : {}),
    };
    return bed.accepts(program) && bed.allows(program.text)
      ? { source, seed, ...program, notes: "typed", ...(standAlone.has(source) ? { standsAlone: true as const } : {}) }
      : undefined;
  };

/** A source that writes JavaScript, for the product alone. */
const untypedForTheProduct =
  (source: string, generate: Generator): Source =>
  (seed, bed) => {
    if (bed.name !== "product") return;
    const program: Program = { text: generate(new Random(seed), false, { library: true }), extension: "js" };
    return bed.accepts(program) && bed.allows(program.text)
      ? { source, seed, ...program, notes: "untyped" }
      : undefined;
  };

/** `rejected` receives the names of the base programs that cannot be used; the caller adds those that differ unchanged. With `alsoInSeveralFiles` each source is there a second time, as `<name>-in-several-files`. */
export async function allSources(
  programsRoot: string,
  rejected: Set<string>,
  alsoInSeveralFiles = false,
): Promise<Record<string, Source>> {
  const sources = await inOneFile(programsRoot, rejected);
  const written = Object.entries(sources).map(
    ([name, source]) => [name + writtenAgain, writtenOnceMore(source)] as const,
  );
  if (alsoInSeveralFiles)
    for (const [name, source] of Object.entries(sources)) sources[name + inSeveralFiles] = laidIntoSeveralFiles(source);
  return { ...sources, ...Object.fromEntries(written) };
}

async function inOneFile(programsRoot: string, rejected: Set<string>): Promise<Record<string, Source>> {
  const sources: Record<string, Source> = {};
  const mutants = mutation(programsRoot, rejected);
  if (mutants) sources.mutation = mutants;
  const unchanged = asTheyAre(programsRoot, "programs-as-they-are", (seed, count) => seed % count);
  if (unchanged) sources["programs-as-they-are"] = unchanged;
  const shuffled = asTheyAre(programsRoot, "programs-in-random-order", (seed, count) =>
    new Random(seed).between(0, count - 1),
  );
  if (shuffled) sources["programs-in-random-order"] = shuffled;
  const pairs = everyBirthAndUse();
  if (pairs) sources["every-birth-and-use"] = pairs;
  if (existsSync(join(import.meta.dir, "one-key-asked-in-every-way.ts"))) {
    const { generate } = await import("./one-key-asked-in-every-way.ts");
    sources["one-key-asked-in-every-way"] = (seed, bed) => {
      if (bed.name !== "product") return;
      const typed = seed % 2 === 1;
      const program: Program = { text: generate(new Random(seed), typed), extension: typed ? "ts" : "js" };
      return bed.accepts(program) && bed.allows(program.text)
        ? { source: "one-key-asked-in-every-way", seed, ...program, notes: typed ? "typed" : "untyped" }
        : undefined;
    };
  }
  if (existsSync(join(import.meta.dir, "names-given-by-key-with-something-done-in-between.ts"))) {
    const { generate } = await import("./names-given-by-key-with-something-done-in-between.ts");
    sources["names-given-by-key-with-something-done-in-between"] = (seed, bed) => {
      if (bed.name !== "product") return;
      const typed = seed % 3 === 1;
      const program: Program = { text: generate(new Random(seed), typed), extension: typed ? "ts" : "js" };
      return bed.accepts(program) && bed.allows(program.text)
        ? {
            source: "names-given-by-key-with-something-done-in-between",
            seed,
            ...program,
            notes: typed ? "typed" : "untyped",
          }
        : undefined;
    };
  }
  if (existsSync(join(import.meta.dir, "text-written-into-parts-of-views.ts"))) {
    const { generate } = await import("./text-written-into-parts-of-views.ts");
    sources["text-written-into-parts-of-views"] = (seed, bed) => {
      if (bed.name !== "product") return;
      const typed = seed % 2 === 1;
      const program: Program = { text: generate(new Random(seed), typed), extension: typed ? "ts" : "js" };
      return bed.accepts(program) && bed.allows(program.text)
        ? { source: "text-written-into-parts-of-views", seed, ...program, notes: typed ? "typed" : "untyped" }
        : undefined;
    };
  }
  if (existsSync(join(import.meta.dir, "arrays-shifted-during-gc.ts"))) {
    const { generate } = await import("./arrays-shifted-during-gc.ts");
    sources["arrays-shifted-during-gc"] = (seed, bed) => {
      if (bed.name !== "product") return;
      const typed = seed % 2 === 1;
      const program: Program = { text: generate(new Random(seed), typed), extension: typed ? "ts" : "js" };
      return bed.accepts(program) && bed.allows(program.text)
        ? { source: "arrays-shifted-during-gc", seed, ...program, notes: typed ? "typed" : "untyped" }
        : undefined;
    };
  }
  if (existsSync(join(import.meta.dir, "bind-spread-flatmap-and-boolean-arithmetic.ts"))) {
    const { generate } = await import("./bind-spread-flatmap-and-boolean-arithmetic.ts");
    sources["bind-spread-flatmap-and-boolean-arithmetic"] = (seed, bed) => {
      if (bed.name !== "product") return;
      const typed = seed % 2 === 1;
      const program: Program = { text: generate(new Random(seed), typed), extension: typed ? "ts" : "js" };
      return bed.accepts(program) && bed.allows(program.text)
        ? { source: "bind-spread-flatmap-and-boolean-arithmetic", seed, ...program, notes: typed ? "typed" : "untyped" }
        : undefined;
    };
  }
  if (existsSync(join(import.meta.dir, "prototype-chains-linked-by-hand.ts"))) {
    const { generate } = await import("./prototype-chains-linked-by-hand.ts");
    sources["prototype-chains-linked-by-hand"] = (seed, bed) => {
      if (bed.name !== "product") return;
      const typed = seed % 2 === 1;
      const program: Program = { text: generate(new Random(seed), typed), extension: typed ? "ts" : "js" };
      return bed.accepts(program) && bed.allows(program.text)
        ? { source: "prototype-chains-linked-by-hand", seed, ...program, notes: typed ? "typed" : "untyped" }
        : undefined;
    };
  }
  if (existsSync(join(import.meta.dir, "sorts-with-hostile-comparators.ts"))) {
    const { generate } = await import("./sorts-with-hostile-comparators.ts");
    sources["sorts-with-hostile-comparators"] = (seed, bed) => {
      if (bed.name !== "product") return;
      const typed = seed % 2 === 1;
      const program: Program = { text: generate(new Random(seed), typed), extension: typed ? "ts" : "js" };
      return bed.accepts(program) && bed.allows(program.text)
        ? { source: "sorts-with-hostile-comparators", seed, ...program, notes: typed ? "typed" : "untyped" }
        : undefined;
    };
  }
  if (existsSync(join(import.meta.dir, "order-of-promise-jobs.ts"))) {
    const { generate } = await import("./order-of-promise-jobs.ts");
    sources["order-of-promise-jobs"] = (seed, bed) => {
      if (bed.name !== "product") return;
      const typed = seed % 2 === 1;
      const program: Program = { text: generate(new Random(seed), typed), extension: typed ? "ts" : "js" };
      return bed.accepts(program) && bed.allows(program.text)
        ? { source: "order-of-promise-jobs", seed, ...program, notes: typed ? "typed" : "untyped" }
        : undefined;
    };
  }
  if (existsSync(join(import.meta.dir, "chains-of-awaits-entered-by-the-host.ts"))) {
    const { generate } = await import("./chains-of-awaits-entered-by-the-host.ts");
    sources["chains-of-awaits-entered-by-the-host"] = (seed, bed) => {
      if (bed.name !== "product") return;
      const typed = seed % 2 === 1;
      const program: Program = { text: generate(new Random(seed), typed), extension: typed ? "ts" : "js" };
      return bed.accepts(program) && bed.allows(program.text)
        ? { source: "chains-of-awaits-entered-by-the-host", seed, ...program, notes: typed ? "typed" : "untyped" }
        : undefined;
    };
  }
  if (existsSync(join(import.meta.dir, "arrays-grown-from-empty-literals.ts"))) {
    const { generate } = await import("./arrays-grown-from-empty-literals.ts");
    sources["arrays-grown-from-empty-literals"] = (seed, bed) => {
      if (bed.name !== "product") return;
      const typed = seed % 2 === 1;
      const program: Program = { text: generate(new Random(seed), typed), extension: typed ? "ts" : "js" };
      return bed.accepts(program) && bed.allows(program.text)
        ? { source: "arrays-grown-from-empty-literals", seed, ...program, notes: typed ? "typed" : "untyped" }
        : undefined;
    };
  }
  if (existsSync(join(import.meta.dir, "closures-in-fields-replaced-from-outside.ts"))) {
    const { generate } = await import("./closures-in-fields-replaced-from-outside.ts");
    sources["closures-in-fields-replaced-from-outside"] = (seed, bed) => {
      if (bed.name !== "product") return;
      const typed = seed % 2 === 1;
      const program: Program = { text: generate(new Random(seed), typed), extension: typed ? "ts" : "js" };
      return bed.accepts(program) && bed.allows(program.text)
        ? { source: "closures-in-fields-replaced-from-outside", seed, ...program, notes: typed ? "typed" : "untyped" }
        : undefined;
    };
  }
  if (existsSync(join(import.meta.dir, "tail-calls-that-hand-rest-parameters-on.ts"))) {
    const { generate } = await import("./tail-calls-that-hand-rest-parameters-on.ts");
    sources["tail-calls-that-hand-rest-parameters-on"] = (seed, bed) => {
      if (bed.name !== "product") return;
      const typed = seed % 2 === 1;
      const program: Program = { text: generate(new Random(seed), typed), extension: typed ? "ts" : "js" };
      return bed.accepts(program) && bed.allows(program.text)
        ? { source: "tail-calls-that-hand-rest-parameters-on", seed, ...program, notes: typed ? "typed" : "untyped" }
        : undefined;
    };
  }
  if (existsSync(join(import.meta.dir, "host-functions-that-throw.ts"))) {
    const { generate } = await import("./host-functions-that-throw.ts");
    sources["host-functions-that-throw"] = (seed, bed) => {
      if (bed.name !== "product") return;
      const typed = seed % 2 === 1;
      const program: Program = { text: generate(new Random(seed), typed), extension: typed ? "ts" : "js" };
      return bed.accepts(program) && bed.allows(program.text)
        ? { source: "host-functions-that-throw", seed, ...program, notes: typed ? "typed" : "untyped" }
        : undefined;
    };
  }
  if (existsSync(join(import.meta.dir, "keys-of-built-in-objects-after-reads-and-copies.ts"))) {
    const { generate } = await import("./keys-of-built-in-objects-after-reads-and-copies.ts");
    sources["keys-of-built-in-objects-after-reads-and-copies"] = (seed, bed) => {
      if (bed.name !== "product") return;
      const typed = seed % 2 === 1;
      const program: Program = {
        text: generate(new Random(seed), typed, seed % 4 >= 2),
        extension: typed ? "ts" : "js",
      };
      return bed.accepts(program) && bed.allows(program.text)
        ? {
            source: "keys-of-built-in-objects-after-reads-and-copies",
            seed,
            ...program,
            notes: typed ? "typed" : "untyped",
          }
        : undefined;
    };
  }
  if (existsSync(join(import.meta.dir, "keys-of-built-in-objects-that-add-members-when-read.ts"))) {
    const { generate, holders, numberOfForms } = await import(
      "./keys-of-built-in-objects-that-add-members-when-read.ts"
    );
    sources["keys-of-built-in-objects-that-add-members-when-read"] = (seed, bed) => {
      if (bed.name !== "product") return;
      const typed = seed % 2 === 1;
      const program: Program = {
        text: generate(
          new Random(seed),
          typed,
          holders[seed % holders.length],
          Math.floor(seed / holders.length) % numberOfForms,
        ),
        extension: typed ? "ts" : "js",
      };
      return bed.accepts(program) && bed.allows(program.text)
        ? {
            source: "keys-of-built-in-objects-that-add-members-when-read",
            seed,
            ...program,
            notes: typed ? "typed" : "untyped",
          }
        : undefined;
    };
  }
  if (existsSync(join(import.meta.dir, "keys-of-built-in-objects-beside-what-a-compiler-writes-itself.ts"))) {
    const { generate, holders, numberOfRounds, uses } = await import(
      "./keys-of-built-in-objects-beside-what-a-compiler-writes-itself.ts"
    );
    sources["keys-of-built-in-objects-beside-what-a-compiler-writes-itself"] = (seed, bed) => {
      if (bed.name !== "product") return;
      const program: Program = {
        text: generate(
          new Random(seed),
          holders[seed % holders.length],
          uses[Math.floor(seed / holders.length) % uses.length],
          Math.floor(seed / (holders.length * uses.length)) % numberOfRounds,
        ),
        extension: "js",
      };
      return bed.accepts(program) && bed.allows(program.text)
        ? {
            source: "keys-of-built-in-objects-beside-what-a-compiler-writes-itself",
            seed,
            ...program,
            notes: "untyped",
          }
        : undefined;
    };
  }
  if (existsSync(join(import.meta.dir, "members-of-built-in-objects-handed-around.ts"))) {
    const { generate } = await import("./members-of-built-in-objects-handed-around.ts");
    sources["members-of-built-in-objects-handed-around"] = (seed, bed) => {
      if (bed.name !== "product") return;
      const typed = seed % 2 === 1;
      const program: Program = { text: generate(new Random(seed), typed), extension: typed ? "ts" : "js" };
      return bed.accepts(program) && bed.allows(program.text)
        ? { source: "members-of-built-in-objects-handed-around", seed, ...program, notes: typed ? "typed" : "untyped" }
        : undefined;
    };
  }
  if (existsSync(join(import.meta.dir, "closures-tested-before-they-leave.ts"))) {
    const { generate } = await import("./closures-tested-before-they-leave.ts");
    sources["closures-tested-before-they-leave"] = (seed, bed) => {
      if (bed.name !== "product") return;
      const program: Program = { text: generate(new Random(seed)), extension: "js" };
      return bed.accepts(program) && bed.allows(program.text)
        ? { source: "closures-tested-before-they-leave", seed, ...program, notes: "untyped" }
        : undefined;
    };
  }
  if (existsSync(join(import.meta.dir, "functions-that-make-many-objects-and-return-one.ts"))) {
    const { generate } = await import("./functions-that-make-many-objects-and-return-one.ts");
    sources["functions-that-make-many-objects-and-return-one"] = (seed, bed) => {
      if (bed.name !== "product") return;
      const program: Program = { text: generate(new Random(seed)), extension: "ts" };
      return bed.accepts(program) && bed.allows(program.text)
        ? { source: "functions-that-make-many-objects-and-return-one", seed, ...program, notes: "typed" }
        : undefined;
    };
  }
  if (existsSync(join(import.meta.dir, "one-name-taken-apart-beside-other-kinds.ts"))) {
    const { generate } = await import("./one-name-taken-apart-beside-other-kinds.ts");
    sources["one-name-taken-apart-beside-other-kinds"] = (seed, bed) => {
      if (bed.name !== "product") return;
      const program: Program = { text: generate(new Random(seed)), extension: "ts" };
      return bed.accepts(program) && bed.allows(program.text)
        ? { source: "one-name-taken-apart-beside-other-kinds", seed, ...program, notes: "typed" }
        : undefined;
    };
  }
  if (existsSync(join(import.meta.dir, "results-of-awaited-steps-used-behind-a-test.ts"))) {
    const { generate } = await import("./results-of-awaited-steps-used-behind-a-test.ts");
    sources["results-of-awaited-steps-used-behind-a-test"] = (seed, bed) => {
      if (bed.name !== "product") return;
      const program: Program = { text: generate(new Random(seed)), extension: "js" };
      return bed.accepts(program) && bed.allows(program.text)
        ? { source: "results-of-awaited-steps-used-behind-a-test", seed, ...program, notes: "untyped" }
        : undefined;
    };
  }
  if (existsSync(join(import.meta.dir, "lists-made-of-what-is-walked-and-used-on-a-rare-path.ts"))) {
    const { generate } = await import("./lists-made-of-what-is-walked-and-used-on-a-rare-path.ts");
    sources["lists-made-of-what-is-walked-and-used-on-a-rare-path"] = (seed, bed) => {
      if (bed.name !== "product") return;
      const program: Program = { text: generate(new Random(seed)), extension: "ts" };
      return bed.accepts(program) && bed.allows(program.text)
        ? { source: "lists-made-of-what-is-walked-and-used-on-a-rare-path", seed, ...program, notes: "typed" }
        : undefined;
    };
  }
  if (existsSync(join(import.meta.dir, "objects-that-may-be-missing-hold-one-another.ts"))) {
    const { generate } = await import("./objects-that-may-be-missing-hold-one-another.ts");
    sources["objects-that-may-be-missing-hold-one-another"] = (seed, bed) => {
      if (bed.name !== "product") return;
      const program: Program = { text: generate(new Random(seed)), extension: "js" };
      return bed.accepts(program) && bed.allows(program.text)
        ? { source: "objects-that-may-be-missing-hold-one-another", seed, ...program, notes: "untyped" }
        : undefined;
    };
  }
  if (existsSync(join(import.meta.dir, "functions-that-keep-very-many-values-alive.ts"))) {
    const { generate } = await import("./functions-that-keep-very-many-values-alive.ts");
    sources["functions-that-keep-very-many-values-alive"] = (seed, bed) => {
      if (bed.name !== "product") return;
      const program: Program = { text: generate(new Random(seed)), extension: "js" };
      return bed.accepts(program) && bed.allows(program.text)
        ? { source: "functions-that-keep-very-many-values-alive", seed, ...program, notes: "untyped" }
        : undefined;
    };
  }
  if (existsSync(join(import.meta.dir, "strings-grown-piece-by-piece-on-many-paths.ts"))) {
    const { generate } = await import("./strings-grown-piece-by-piece-on-many-paths.ts");
    sources["strings-grown-piece-by-piece-on-many-paths"] = (seed, bed) => {
      if (bed.name !== "product") return;
      const program: Program = { text: generate(new Random(seed)), extension: "js" };
      return bed.accepts(program) && bed.allows(program.text)
        ? { source: "strings-grown-piece-by-piece-on-many-paths", seed, ...program, notes: "untyped" }
        : undefined;
    };
  }
  if (existsSync(join(import.meta.dir, "compiled-code-calls-text-made-at-run-time.ts"))) {
    const { generate } = await import("./compiled-code-calls-text-made-at-run-time.ts");
    sources["compiled-code-calls-text-made-at-run-time"] = (seed, bed) => {
      if (bed.name !== "product") return;
      const program: Program = { text: generate(new Random(seed)), extension: "js" };
      return bed.accepts(program) && bed.allows(program.text)
        ? { source: "compiled-code-calls-text-made-at-run-time", seed, ...program, notes: "untyped" }
        : undefined;
    };
  }
  if (existsSync(join(import.meta.dir, "methods-of-helper-objects-define-members-under-written-names.ts"))) {
    const { generate } = await import("./methods-of-helper-objects-define-members-under-written-names.ts");
    sources["methods-of-helper-objects-define-members-under-written-names"] = (seed, bed) => {
      if (bed.name !== "product") return;
      const program: Program = { text: generate(new Random(seed)), extension: "js" };
      return bed.accepts(program) && bed.allows(program.text)
        ? { source: "methods-of-helper-objects-define-members-under-written-names", seed, ...program, notes: "untyped" }
        : undefined;
    };
  }
  if (existsSync(join(import.meta.dir, "long-array-literals-of-mixed-constants.ts"))) {
    const { generate } = await import("./long-array-literals-of-mixed-constants.ts");
    sources["long-array-literals-of-mixed-constants"] = (seed, bed) => {
      if (bed.name !== "product") return;
      const program: Program = { text: generate(new Random(seed)), extension: "js" };
      return bed.accepts(program) && bed.allows(program.text)
        ? { source: "long-array-literals-of-mixed-constants", seed, ...program, notes: "untyped" }
        : undefined;
    };
  }
  if (existsSync(join(import.meta.dir, "very-many-values-alive-across-very-many-blocks.ts"))) {
    const { generate } = await import("./very-many-values-alive-across-very-many-blocks.ts");
    sources["very-many-values-alive-across-very-many-blocks"] = (seed, bed) => {
      if (bed.name !== "product") return;
      const typed = seed % 2 === 1;
      const program: Program = { text: generate(new Random(seed), typed), extension: typed ? "ts" : "js" };
      return bed.accepts(program) && bed.allows(program.text)
        ? {
            source: "very-many-values-alive-across-very-many-blocks",
            seed,
            ...program,
            notes: typed ? "typed" : "untyped",
          }
        : undefined;
    };
  }
  if (existsSync(join(import.meta.dir, "unsound-types.ts"))) {
    const { draw } = await import("./unsound-types.ts");
    sources["unsound-types"] = (seed, bed) => {
      if (bed.name !== "product") return;
      const { text, hole, parts, alone } = draw(new Random(seed));
      return {
        source: "unsound-types",
        seed,
        text,
        extension: "ts",
        notes: parts.map(each => each.join(", ")).join(" | "),
        group: hole,
        alone,
        isForTypeScript: true,
      };
    };
  }
  for (const name of [
    "grammar",
    "protocols",
    "new-targets",
    "object-mutations",
    "typed-object-mutations",
    "held-across-suspensions",
    "where-the-stack-ends",
    "many-of-one-thing",
    "changing-buffers",
    "many-live-values",
    "a-throw-at-every-call",
    "values-across-joins",
    "operators-at-the-edges",
    "objects-across-awaits",
    "every-kind-of-job",
    "work-on-the-way-up",
    "text-beside-compiled-code",
    "several-changes-one-behind-the-other",
  ])
    if (existsSync(join(import.meta.dir, name + ".ts"))) sources[name] = generated(name, generateOf(name));
  for (const name of [
    "when-the-heap-is-full",
    "held-by-one-thing-alone",
    "errors-nobody-catches",
    "shapes-that-die-and-come-again",
    "workers-ended-in-the-middle",
    "calls-with-very-many-arguments",
    "strings-still-in-pieces",
    "strings-whose-storage-changes-width-behind-their-parts",
    "changed-while-it-is-walked",
    "left-half-way",
    "numbers-across-their-borders",
    "at-the-border-of-a-representation",
    "patterns-made-at-run-time",
    "lists-read-where-they-are-made",
    "numbers-however-they-are-kept",
    "objects-read-where-they-are-made",
    "patterns-that-go-back-for-millions-of-turns",
    "errors-of-values-nobody-uses",
    "operations-that-throw-for-what-they-are-given",
    "constant-lists-changed-by-every-road",
    "new-objects-kept-through-built-ins",
    "typed-instances-changed-through-built-ins",
    "several-changes-behind-a-declared-type",
    "two-names-where-ways-meet",
    "objects-with-very-many-fields",
    "one-name-for-many-kinds-of-things",
    "objects-that-the-host-keeps-and-hands-back",
    "closures-read-through-array-methods",
    "objects-that-live-for-one-turn-of-a-loop",
    "patterns-with-subjects-made-from-them",
    "bodies-in-every-encoding-read-as-json",
    "read-by-the-last-holder-while-others-are-made",
    "instances-below-built-in-classes-frozen-closed-and-redefined",
    "code-the-build-never-saw-changes-what-it-is-handed",
    "lists-of-numbers-through-one-map-or-filter",
    "loops-whose-tests-are-settled-on-the-first-turn",
    "loops-over-variables-of-enclosing-code",
    "counters-handed-to-the-one-call-in-a-loop",
    "strangers-where-a-type-names-a-class",
    "holders-with-the-same-keys-and-one-stranger",
    "names-asked-of-full-tables-and-texts-converted-again",
    "a-full-heap-is-let-go-and-built-ins-make-things",
    "static-fields-hold-values-outside-their-declared-types",
    "int32-fields-read-under-keys-as-operands",
    "values-of-another-kind-through-type-parameters",
    "values-of-another-kind-behind-a-test",
    "variables-that-never-took-their-class-are-constructed-called-and-extended",
    "values-that-hold-themselves-written-as-json",
    "records-with-open-members-around-rings-written-as-json",
    "functions-capture-what-is-made-of-a-value-declared-as-another-type",
    "a-class-definition-throws-and-the-program-goes-on",
    "a-field-of-an-element-is-tested-stored-to-and-read-again-in-one-turn-of-a-loop",
  ])
    if (existsSync(join(import.meta.dir, name + ".ts"))) sources[name] = typedForTheProduct(name, generateOf(name));
  for (const name of [
    "what-a-callback-declares-however-it-reaches-a-built-in",
    "tests-that-ask-which-runtime-this-is",
    "what-a-function-declares-however-often-call-and-apply-enter-it",
    "makers-of-makers-each-with-a-prototype-of-its-own",
    "built-ins-called-often-through-unknown-values",
    "values-that-end-before-a-suspension-beside-values-that-cross-it",
    "tail-calls-between-the-program-and-functions-made-from-text",
    "arguments-made-for-a-call-whose-callee-may-return-early",
    "functions-handed-to-async-functions-and-used-around-their-awaits",
    "functions-that-return-before-they-touch-what-the-caller-made",
    "elements-stored-below-an-object-that-intercepts-them",
    "sums-of-whole-numbers-at-the-edges-of-what-a-double-holds",
    "host-functions-throw-in-code-that-built-ins-call",
    "one-call-reaches-either-of-two-built-ins",
    "an-element-is-tested-stored-to-and-read-again-in-one-turn-of-a-loop",
    "closures-made-in-the-heads-and-bodies-of-loops",
    "optional-chains-with-calls-keys-and-deletes",
    "stack-positions-behind-folded-constants",
    "what-a-built-in-calls-changes-an-object-the-program-holds",
  ])
    if (existsSync(join(import.meta.dir, name + ".ts"))) sources[name] = untypedForTheProduct(name, generateOf(name));
  const named =
    (source: string, drawn: Drawn): Source =>
    (seed, bed) => {
      const made = drawn(seed, bed);
      return made && { source, ...made };
    };
  const inWords = (name: string) => name.replaceAll("-", " ");
  // Modules that count their programs and make the one at an index.
  for (const name of [
    "a-class-of-a-file-is-kept-as-a-value-and-named-again-only-by-code-that-never-runs",
    "a-declaration-that-nothing-uses-throws-or-runs-code-where-it-stands",
    "a-fresh-object-is-the-source-of-a-copy",
    "a-host-object-comes-back-by-some-road-and-its-members-are-listed",
    "a-loop-over-a-typed-array-is-handed-something-else-than-its-type-says",
    "a-loop-tests-for-what-a-function-it-calls-is-the-first-to-ask-for",
    "a-member-is-read-under-a-key-made-at-run-time-and-only-asked-whether-it-is-there",
    "a-trap-is-stored-on-the-handler-after-the-proxy-is-made",
    "a-turn-over-a-typed-array-keeps-or-stores-one-of-two-values",
    "a-variable-of-a-file-is-handed-to-a-factory-and-read-again-by-code-that-never-runs",
    "a-walk-over-an-object-nobody-knows-reads-a-member-that-runs-code",
    "an-object-with-many-keys-and-a-name-that-an-object-above-has-too-is-listed",
    "classes-that-a-function-returns",
    "every-getter-of-a-host-object-that-came-through-other-hands-is-read-under-a-key-made-at-run-time",
    "files-used-only-for-their-types",
    "lists-stored-differently-arrive-at-one-parameter",
    "narrow-elements-are-computed-at-the-edge-of-what-they-hold",
    "objects-whose-field-is-stored-differently-arrive-at-one-parameter",
    "one-thing-is-done-to-every-element-while-other-code-runs-around-the-loop",
    "patterns-made-at-run-time-whose-runs-begin-at-many-places-of-one-stretch",
    "the-elements-of-a-typed-array-are-added-up-from-every-start",
    "writes-to-copies-of-changed-objects",
  ])
    if (existsSync(join(import.meta.dir, name + ".ts")))
      sources[name] = named(name, table(inWords(name), tableOf(name)));
  // Modules that hand over whole programs, files and all.
  for (const name of [
    "a-function-that-one-odd-road-calls-with-what-its-callers-never-hand-it",
    "a-short-loop-whose-every-turn-reads-what-one-rare-turn-changes",
    "accessors-of-a-literal-written-in-any-order-among-its-other-members",
    "an-object-written-in-a-call-and-what-the-callee-does-with-it",
    "calls-in-the-tail-of-a-function-that-a-built-in-calls",
    "classes-that-one-function-makes-below-whatever-it-is-handed",
    "closures-and-stores-where-a-program-does-not-run-in-the-order-of-its-text",
    "closures-that-leave-the-function-that-made-them-by-one-road",
    "data-files-read-across-cycles-of-imports",
    "half-made-things-read-where-what-was-thrown-in-the-middle-is-caught",
    "json-texts-of-many-sizes-written-one-after-another-and-inside-each-other",
    "keys-and-json-of-an-object-that-one-road-has-changed",
    "members-read-beside-an-accessor-that-is-defined-under-another-key",
    "modules-asked-for-again-after-they-have-run",
    "objects-that-leave-the-function-that-made-them-by-one-road",
    "one-built-in-asked-at-two-places-that-do-different-things-with-its-answer",
    "private-names-laid-on-objects-that-the-class-did-not-make-itself",
    "questions-about-a-member-that-the-kind-it-is-used-as-would-answer",
    "questions-that-the-kind-a-value-is-used-as-would-answer-by-itself",
    "symbols-made-at-one-place-of-the-text-and-used-as-keys",
    "tables-at-the-top-of-a-file-that-one-road-changes",
    "two-names-for-one-thing-read-stored-to-and-read-again",
    "variables-of-a-file-reached-while-the-file-has-not-run-to-its-end",
    "what-a-suspended-function-finds-in-its-variables-when-it-goes-on",
    "what-is-walked-changes-while-it-is-walked",
    "what-nobody-names-is-still-seen-by-one-road",
    "when-a-function-goes-on-behind-an-await-of-what-is-already-settled",
    "who-is-called-when-the-name-of-a-function-is-stored-to-while-it-runs",
  ])
    if (existsSync(join(import.meta.dir, name + ".ts")))
      sources[name] = named(
        name,
        whole(inWords(name), generateOf(name), seed => new Random(seed)),
      );
  // The lists of ./sources, each a source by the name of its file (family.ts).
  const lists = join(import.meta.dir, "sources");
  for (const file of existsSync(lists) ? readdirSync(lists).sort() : [])
    sources[file.replace(/\.ts$/, "")] = named(file.replace(/\.ts$/, ""), (seed, bed) =>
      require(`./sources/${file}`).default(seed, bed),
    );
  return sources;
}
