/** @jsxRuntime classic */
/** @jsx make */
// A character reference in JSX, and a member of an enum, may hold half of a pair. The text of the function holds it as an escape, so the text evaluated again makes the same string.
const make = (tag: string, props: { title?: string } | null, ...children: string[]) =>
  [tag, props?.title ?? "", ...children].map(text =>
    [...Array(text.length).keys()].map(at => text.charCodeAt(at).toString(16)).join("."),
  );
declare global {
  namespace JSX {
    interface IntrinsicElements {
      half: { title?: string; children?: string };
    }
  }
}
enum Half {
  High = "a\uD83Db",
}
const again = (text: unknown) => new Function("make", "return (" + text + ")")(make);
const forms = [
  () => <half title="x&#xD83D;y">p&#xDE00;q</half>,
  () => <half>&#x1F600;</half>,
  () => make(Half.High, null),
];
for (const form of forms) console.log(JSON.stringify(again(form)()), JSON.stringify(form()));
export {};
