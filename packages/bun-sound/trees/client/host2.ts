// host2.ts: host.ts of the measured tree, for the WIDE tree: the root's tag can be chosen, portals, hidden nodes are seen, errors are handed on, the tree is printed in plain words.
import createReconciler from "react-reconciler";
import { DefaultEventPriority, NoEventPriority } from "react-reconciler/constants";
import { createContext, type ReactNode } from "react";

export type HostNode = {
  type: string;
  props: Record<string, unknown>;
  children: (HostNode | HostText)[];
  parent: HostNode | null;
};
export type HostText = { type: "#text"; text: string; parent: HostNode | null };

export const stats = { commits: 0, created: 0, updated: 0, textUpdates: 0, bytes: 0, hash: 0 };
let paint = true;
export function setPaint(on: boolean) { paint = on; }

function serialize(node: HostNode | HostText, out: string[], depth: number): void {
  if (node.type === "#text") { out.push((node as HostText).text); return; }
  const n = node as HostNode;
  const p = n.props;
  if (n.type === "ink-box") {
    const pad = (p.paddingLeft as number | undefined) ?? 0;
    if (pad) out.push(" ".repeat(pad));
    const column = p.flexDirection === "column";
    for (let i = 0; i < n.children.length; i++) {
      serialize(n.children[i]!, out, depth + 1);
      if (column) out.push("\n");
    }
    return;
  }
  const color = p.color as string | undefined;
  if (color) out.push("\x1b[38;5;", color, "m");
  if (p.bold) out.push("\x1b[1m");
  if (p.dim) out.push("\x1b[2m");
  for (let i = 0; i < n.children.length; i++) serialize(n.children[i]!, out, depth + 1);
  if (color || p.bold || p.dim) out.push("\x1b[0m");
}

let priority = NoEventPriority;
const remove = (parent: HostNode, child: HostNode | HostText) => {
  const i = parent.children.indexOf(child);
  if (i >= 0) parent.children.splice(i, 1);
  child.parent = null;
};
const append = (parent: HostNode, child: HostNode | HostText) => {
  if (child.parent) remove(child.parent, child);
  child.parent = parent;
  parent.children.push(child);
};
const insertBefore = (parent: HostNode, child: HostNode | HostText, before: HostNode | HostText) => {
  if (child.parent) remove(child.parent, child);
  child.parent = parent;
  const i = parent.children.indexOf(before);
  if (i >= 0) parent.children.splice(i, 0, child); else parent.children.push(child);
};

const reconciler = createReconciler({
  getRootHostContext: () => ({ inText: false }),
  getChildHostContext: (parent: { inText: boolean }, type: string) => {
    const inText = type === "ink-text";
    return parent.inText === inText ? parent : { inText };
  },
  prepareForCommit: () => null,
  preparePortalMount: () => null,
  clearContainer: () => false,
  resetAfterCommit(root: HostNode) {
    stats.commits++;
    if (!paint) return;
    const out: string[] = [];
    serialize(root, out, 0);
    const text = out.join("");
    stats.bytes += text.length;
    let h = stats.hash;
    for (let i = 0; i < text.length; i += 7) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
    stats.hash = h;
  },
  shouldSetTextContent: () => false,
  createInstance(type: string, props: Record<string, unknown>): HostNode {
    stats.created++;
    return { type, props, children: [], parent: null };
  },
  createTextInstance(text: string): HostText {
    stats.created++;
    return { type: "#text", text, parent: null };
  },
  resetTextContent() {},
  hideTextInstance(n: HostText) { n.text = "~" + n.text; },
  unhideTextInstance(n: HostText, text: string) { n.text = text; },
  getPublicInstance: (i: unknown) => i,
  hideInstance(n: HostNode) { n.props = { ...n.props, hidden: true }; },
  unhideInstance(n: HostNode, props: Record<string, unknown>) { n.props = props; },
  appendInitialChild: append,
  appendChild: append,
  insertBefore,
  finalizeInitialChildren: () => false,
  isPrimaryRenderer: true,
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,
  noTimeout: -1,
  beforeActiveInstanceBlur() {},
  afterActiveInstanceBlur() {},
  detachDeletedInstance() {},
  getInstanceFromNode: () => null,
  prepareScopeUpdate() {},
  getInstanceFromScope: () => null,
  appendChildToContainer: append,
  insertInContainerBefore: insertBefore,
  removeChildFromContainer: remove,
  commitUpdate(node: HostNode, _type: string, _old: unknown, props: Record<string, unknown>) {
    stats.updated++;
    node.props = props;
  },
  commitTextUpdate(node: HostText, _old: string, text: string) {
    stats.textUpdates++;
    node.text = text;
  },
  removeChild: remove,
  setCurrentUpdatePriority(p: number) { priority = p; },
  getCurrentUpdatePriority: () => priority,
  resolveUpdatePriority: () => (priority !== NoEventPriority ? priority : DefaultEventPriority),
  maySuspendCommit: () => false,
  NotPendingTransition: undefined,
  HostTransitionContext: createContext(null) as never,
  resetFormInstance() {},
  requestPostPaintCallback() {},
  shouldAttemptEagerTransition: () => false,
  trackSchedulerEvent() {},
  resolveEventType: () => null,
  resolveEventTimeStamp: () => -1.1,
  preloadInstance: () => true,
  startSuspendingCommit() {},
  suspendInstance() {},
  waitForCommitToBeReady: () => null,
} as never);

export function print(node: HostNode | HostText): string {
  if (node.type === "#text") return JSON.stringify((node as HostText).text);
  const n = node as HostNode;
  const props = Object.keys(n.props).filter(k => k !== "children" && typeof n.props[k] !== "function" && n.props[k] !== undefined).sort().map(k => " " + k + "=" + String(n.props[k])).join("");
  return "<" + n.type.replace("ink-", "") + props + ">" + n.children.map(print).join("") + "</>";
}
export function newContainer(name: string): HostNode { return { type: "ink-" + name, props: {}, children: [], parent: null }; }
export function createPortal(children: ReactNode, container: HostNode, key: string | null = null): ReactNode { return (reconciler as any).createPortal(children, container, null, key); }
export function mount2(element: ReactNode, tag: 0 | 1, log: (line: string) => void) {
  const root = newContainer("root");
  const said = (kind: string) => (error: unknown) => log(kind + ": " + (error instanceof Error ? error.name + " " + error.message : String(error)));
  const container = (reconciler as any).createContainer(root, tag, null, false, null, "id", said("uncaught"), said("caught"), said("recoverable"), () => {}, null);
  const flush = () => (reconciler as any).flushSyncWork();
  const render = (next: ReactNode) => { (reconciler as any).updateContainerSync(next, container, null, () => {}); flush(); };
  render(element);
  return {
    root, flush, render,
    sync: (fn: () => void) => (reconciler as any).flushSyncFromReconciler(fn),
    batched: (fn: () => void) => (reconciler as any).batchedUpdates(fn, null),
    later: (next: ReactNode) => (reconciler as any).updateContainer(next, container, null, () => {}),
    passive: () => (reconciler as any).flushPassiveEffects(),
    show: () => print(root),
  };
}
