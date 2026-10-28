// The programs about the collector with a collection asked for every millisecond, marking beside the program, and every freed cell overwritten: once as the collector chooses, mostly eden collections, and once with full collections alone.
// A list of Structures that was emptied at the start of a collection kept what the program noted while that collection marked. A full collection freed some of it at its end, and the next one read the freed cells: programs/collector/objects-with-many-new-names-are-made-while-a-collection-marks.js died every time under full collections and never under any other recipe of these tests.
import { programsBuiltWith } from "./run-programs";

const besideTheProgram = {
  BUN_JSC_collectContinuously: "1",
  BUN_JSC_collectContinuouslyPeriodMS: "1",
  BUN_JSC_useZombieMode: "1",
  BUN_JSC_scribbleFreeCells: "1",
};
const fullCollections = { ...besideTheProgram, BUN_JSC_useGenerationalGC: "0" };
programsBuiltWith("collector", "collections-beside-the-program", [], besideTheProgram);
programsBuiltWith("collector", "full-collections-beside-the-program", [], fullCollections);
programsBuiltWith("collector", "full-collections-beside-the-program-went-wrong", [], fullCollections, 1, 1, [
  "objects-with-many-new-names-are-made-while-a-collection-marks",
  "objects-with-many-new-names-are-made-by-natives-while-a-collection-marks",
]);
