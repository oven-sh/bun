declare const NAME: string;
export function View({ title }: { title: string }) {
  let text = "";
  {
    const target = title + "!";
    text = target;
  }
  const lines = [NAME, text];
  return <p>{lines.join(" ")}</p>;
}
