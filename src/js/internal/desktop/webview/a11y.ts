// From the accessibility tree of the DevTools protocol to what `surface.a11y` takes.
const roles = { RootWebArea: "document", StaticText: "text", image: "img", none: "generic" };
const flags = [
  "expanded",
  "selected",
  "disabled",
  "readonly",
  "required",
  "focusable",
  "level",
  "live",
  "url",
  "modal",
];
const tristate = (value: unknown) => (value === "mixed" ? value : value === undefined ? undefined : value === "true");

/** The ids are those of the DOM nodes, for the actions to find them. `scale` is what the bounds are multiplied by. */
function convert(all: any[], { nodes: dom, layout, scrollOffsetX, scrollOffsetY }: any, scale: number) {
  const bounds = new Map<number, number[]>();
  layout.nodeIndex.forEach((node: number, index: number) => {
    const [x, y, width, height] = layout.bounds[index];
    bounds.$set(
      dom.backendNodeId[node],
      [x - scrollOffsetX, y - scrollOffsetY, width, height].map(it => it / scale),
    );
  });
  const byId = new Map<string, any>(all.map(node => [node.nodeId, node]));
  const isShown = (node: any) => !node.ignored && node.backendDOMNodeId;
  const shownIn = (node: any, depth: number): any[] =>
    (depth < 500 ? (node.childIds ?? []) : [])
      .map(id => byId.$get(id))
      .flatMap(child => (!child ? [] : isShown(child) ? [child] : shownIn(child, depth + 1)));
  let focus = all[0].backendDOMNodeId;
  const nodes = all.filter(isShown).map(node => {
    const has = Object.fromEntries((node.properties ?? []).map(({ name, value }) => [name, value.value]));
    const role = has.multiline ? "multilineTextbox" : (roles[node.role.value] ?? node.role.value);
    if (has.focused) focus = node.backendDOMNodeId;
    return {
      ...Object.fromEntries(flags.map(name => [name, has[name]])),
      id: node.backendDOMNodeId,
      role: /^[A-Z]/.test(role) ? "generic" : role,
      label: node.name?.value || undefined,
      value: node.value?.value === undefined ? undefined : String(node.value.value),
      description: node.description?.value,
      bounds: bounds.$get(node.backendDOMNodeId) ?? [0, 0, 0, 0],
      children: shownIn(node, 0).map(child => child.backendDOMNodeId),
      checked: tristate(has.checked),
      pressed: tristate(has.pressed),
      clickable: !!has.focusable,
      min: has.valuemin,
      max: has.valuemax,
    };
  });
  return { nodes, focus };
}

export default { convert };
