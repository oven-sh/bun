declare const NAME: string;
export function Local(props: { title: string }) {
  const target = props.title;
  const lines = [NAME, "remembered"];
  return <p>{lines.join(" ")}</p>;
}
export function Other({ title }: { title: string }) {
  return <b>{title}</b>;
}
