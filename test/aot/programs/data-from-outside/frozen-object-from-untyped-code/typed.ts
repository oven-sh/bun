type Props = { n: number };
export function double({ n }: Props) {
  return n * 2;
}
type Thing = { id: string };
type LabelProps = { thing: Thing; children: unknown };
export function label(props: LabelProps) {
  return props.thing.id + String(props.children) + Object.isFrozen(props);
}
type ListProps = { list: number[] };
export function total({ list }: ListProps) {
  return list.reduce((sum, value) => sum + value, 0);
}
