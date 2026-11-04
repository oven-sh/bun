// Names of parameter properties that are words of the language in other places, and one written with an escape.
class Words { constructor(public get: number, public set: number, public async: number, public of: number, public accessor: number, public abc: number, public $: number, public _: number) {} }
const Again = (0, eval)("(" + String(Words) + ")");
for (const Made of [Words, Again]) console.log(JSON.stringify(new Made(1, 2, 3, 4, 5, 6, 7, 8)));
