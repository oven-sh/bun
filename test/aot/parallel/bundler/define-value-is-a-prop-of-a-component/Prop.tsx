declare const NAME: string;
export function Prop({ target }: { target: string }) {
  const lines = [NAME, "remembered"];
  return <p>{lines.join(" ")}</p>;
}
