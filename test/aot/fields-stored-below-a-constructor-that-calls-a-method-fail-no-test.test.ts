// A base class whose constructor calls a method of the object (`this.setup()`), and classes below it that declare fields and assign them behind `super()`.
// No method that is reached closes the object or redefines a property of it, so each assignment stores to the slot of its field: no test fails, and nothing is
// looked up by name. The counts are exact: no clock and no machine decides them.
import { expect } from "bun:test";
import { tempDirWithBunTypes as tempDir } from "harness";
import { buildCounted, countScript, testsAddedByTheCompiler } from "./harness/counted-run";
import { slot } from "./run-programs";
import { test } from "./supported";

const files = {
  "widgets.ts": `
    class Widget {
      id: number;
      ready: boolean;
      constructor(id: number) {
        this.id = id;
        this.ready = false;
        this.setup();
      }
      setup(): void {}
    }
    class Label extends Widget {
      left: number;
      top: number;
      width: number;
      height: number;
      text: string;
      constructor(id: number, text: string) {
        super(id);
        this.left = id;
        this.top = id + 1;
        this.width = id + 2.5;
        this.height = id + 3.5;
        this.text = text;
      }
    }
    class Button extends Widget {
      left: number;
      top: number;
      pressed: boolean;
      label: Label | null;
      constructor(id: number) {
        super(id);
        this.left = id;
        this.top = id + 1;
        this.pressed = false;
        this.label = null;
      }
      setup(): void {
        this.ready = true;
      }
    }
    const registry: Widget[] = [];
    class Listed extends Widget {
      left: number;
      top: number;
      width: number;
      constructor(id: number) {
        super(id);
        this.left = id;
        this.top = id + 1;
        this.width = id + 2;
      }
      setup(): void {
        registry.push(this);
      }
    }
    class Panel extends Label {
      depth: number;
      shade: number;
      open: boolean;
      constructor(id: number) {
        super(id, "panel");
        this.depth = id;
        this.shade = id + 0.5;
        this.open = true;
        this.arrange();
      }
      arrange(): void {}
    }
    class Dialog extends Panel {
      title: string;
      modal: boolean;
      order: number;
      constructor(id: number) {
        super(id);
        this.title = "dialog";
        this.modal = true;
        this.order = id;
      }
    }
    const made: Widget[] = [];
    const units = Number(process.argv[2]);
    let sum = 0;
    for (let index = 0; index < units; index++) {
      const label = new Label(index, "label");
      const button = new Button(index);
      const listed = new Listed(index);
      const dialog = new Dialog(index);
      made.push(label, button, listed, dialog);
      sum += label.left + label.height + label.text.length + button.top + (button.ready ? 1 : 0) + listed.width;
      sum += dialog.order + dialog.shade + dialog.title.length + dialog.top;
    }
    console.log(sum > 0 && made.length === units * 4 && registry.length === units ? "ok" : "no");
  `,
};

test(
  "assignments to the fields of classes below a constructor that calls a method",
  () =>
    slot(async () => {
      using dir = tempDir("aot-fields-below-a-constructor-that-calls-a-method", files);
      const folder = String(dir);
      const work = await countScript(await buildCounted(folder, "./widgets.ts"), folder, "ok\n");
      // The four objects of a unit are made: nothing is counted of objects that the compiler removed.
      expect(work.allocated.cells).toBeGreaterThanOrEqual(4);
      const added = [...work.tests, ...work.uneven].filter(counted => testsAddedByTheCompiler.has(counted.kind));
      expect(added.filter(counted => counted.failed).map(counted => `${counted.kind} ${counted.position}`)).toEqual([]);
      expect(work.accessesByName).toBe(0);
    }),
  300_000,
);
