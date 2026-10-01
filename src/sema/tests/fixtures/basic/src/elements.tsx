declare global {
  namespace JSX {
    interface Element {
      tag: string
    }
    interface ElementChildrenAttribute {
      children: {}
    }
    interface IntrinsicElements {
      box: { gap?: number; onPress?: (at: { x: number; y: number }) => void; children?: unknown }
    }
  }
}
type Choice<T> = { label: string; value: T }
type PickerProps<T> = {
  options: Choice<T>[]
  defaultValue?: T
  disabled?: boolean
  onChange?: (value: T) => void
  render?: (o: Choice<T>, index: number) => string
}
declare function Picker<T>(props: PickerProps<T>): JSX.Element
declare function Constrained<T extends string>(props: PickerProps<T>): JSX.Element
declare function Plain(props: PickerProps<number>): JSX.Element
declare function Wrap<T>(props: { value: T; children: (v: T) => number }): JSX.Element
declare function Many<T>(props: { first: T; children: T[] }): JSX.Element
declare class Panel<T> {
  constructor(props: { item: T; onOpen: (item: T) => void })
  props: { item: T; onOpen: (item: T) => void }
}
const letters = [{ label: 'a', value: 'x' as const }, { label: 'b', value: 'y' as const }]
const spreadable = { options: letters }
export const elements = [
  <Picker options={letters} onChange={choice => void choice} />,
  <Picker options={[{ label: 'n', value: 1 }]} onChange={n => void n} render={(o, i) => o.label + i} />,
  <Picker onChange={c => void c} options={letters} disabled />,
  <Constrained options={letters} onChange={c => void c} />,
  <Plain options={[]} onChange={n => void n} />,
  <Picker<boolean> options={[]} onChange={b => void b} />,
  <Wrap value={1}>{v => v + 1}</Wrap>,
  <Picker options={letters} defaultValue="x" onChange={c => void c} />,
  <Picker {...spreadable} onChange={c => void c} />,
  <Panel item={{ id: 1 }} onOpen={item => void item.id} />,
  <box gap={1} onPress={at => void at.x} />,
  <box>
    <Picker options={[{ label: 'in', value: true }]} onChange={inner => void inner} />
  </box>,
]
