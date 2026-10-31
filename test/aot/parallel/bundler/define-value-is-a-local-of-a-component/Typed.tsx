declare const NAME: string;
export function Typed(props: { title: string }) {
  const target = props.title;
  const lines = [NAME, "remembered"];
  return <p>{lines.join(" ")}</p>;
}
