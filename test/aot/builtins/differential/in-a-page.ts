// Instances of the interfaces of the web. Each is made in a page of its own.
import { desktopInternals } from "bun:internal-for-testing";
import type { Open } from "../native-contract/host-instances";

const tags = "a body canvas div form frameset iframe img input script select slot template textarea".split(" ");

const markup = `<!doctype html><title>a</title>
  <p id=a class="a b" style="top: 0">text<b>bold</b><!--comment--></p>
  <form><input name=a type=radio><input name=a type=radio><input type=file><select><option>a<option>b</select><button></button></form>
  <math><mi>a</mi></math>`;

const events = ["CustomEvent", "ErrorEvent", "Event", "KeyboardEvent", "MouseEvent"];

type Page = { window: any; document: any; $(selector: string): any };

const makers: ((page: Page) => unknown)[] = [
  ...tags.map(
    tag =>
      ({ document }: Page) =>
        document.body.appendChild(document.createElement(tag)),
  ),
  ({ $ }) => $("mi"),
  ...events.map(
    name =>
      ({ window }: Page) =>
        new window[name]("a"),
  ),
  ({ window }) => new window.DocumentFragment(),
  ({ document }) => document,
  ({ document }) => document.createElementNS("http://www.w3.org/2000/svg", "unknown"),
  ({ document }) => document.doctype,
  ({ document }) => document.createProcessingInstruction("a", "b"),
  ({ document }) => document.implementation.createDocument(null, "a").createCDATASection("a"),
  ({ document }) => document.createEvent("BeforeUnloadEvent"),
  ({ $ }) => $("p").firstChild,
  ({ $ }) => $("p").lastChild,
  ({ $ }) => $("p").attributes[0],
  ({ $ }) => $("p").classList,
  ({ $ }) => $("p").childNodes,
  ({ $ }) => $("p").children,
  ({ $ }) => $("p").dataset,
  ({ $ }) => $("p").attachShadow({ mode: "open" }),
  ({ $ }) => $("form").elements,
  ({ $ }) => $("form").elements.a,
  ({ $ }) => $("select").options,
  () => require("bun:desktop/electron").nativeImage.createEmpty(),
];

let nextFontScope = 1000;

function openPage() {
  const opened = desktopInternals.createPage({ native: null, surface: 0, fontScope: nextFontScope++ });
  opened.parseHTML(markup);
  return opened;
}

// Constructors take the first page for that of the realm, so it stays.
let pageOfRealm: object | undefined;

const inAPage =
  (make: (page: Page) => unknown): Open =>
  async () => {
    pageOfRealm ??= openPage();
    const controls = openPage();
    const { window, document } = controls;
    const value = await make({ window, document, $: selector => document.querySelector(selector) });
    return { value: value as object, close: () => controls.dispose() };
  };

export const openersOfWhatPagesHold: Open[] = makers.map(inAPage);
