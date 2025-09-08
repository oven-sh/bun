function isModifiedEvent(event: MouseEvent) {
  return !!(event.metaKey || event.altKey || event.ctrlKey || event.shiftKey);
}

export function shouldProcessLinkClick(event: MouseEvent, target?: string): boolean {
  return (
    event.button === 0 && // Ignore everything but left clicks
    (!target || target === "_self") && // Let browser handle "target=_blank" etc.
    !isModifiedEvent(event) // Ignore clicks with modifier keys
  );
}
