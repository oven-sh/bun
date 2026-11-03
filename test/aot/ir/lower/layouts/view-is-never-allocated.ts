// RUN(VIEW): link
// VIEW: layout [[view]] name="View" {{*}}fields=[{key="_viewBrand" {{*}}flags=[IsNeverWritten]}, {key="id" {{*}}flags=[IsRequired]}] flags=[IsNeverAllocated]

// RUN(STORED): link
// STORED: layout [[stored]] name="Stored" {{*}}fields=[{key="late" {{*}}flags=[IsRequired]}] flags=[IsNeverAllocated]

// RUN(MADE): link
// MADE: layout [[made]] name="Made" {{*}}fields=[{key="id" {{*}}flags=[IsRequired]}, {key="label" {{*}}flags=[IsRequired]}]

// RUN(USED): link
// USED-NOT: layout {{*}}name="Made" {{*}}IsNever

interface Made {
  id: number;
  label: string;
}

// Nothing makes an object with these names, and nothing ever writes `_viewBrand`.
interface View {
  _viewBrand: any;
  id: number;
}

// Nothing makes an object with this one name either, but a store writes it.
interface Stored {
  late: number;
}

export function make(id: number): Made {
  return { id, label: "made" };
}

export function read(view: View): number {
  return view.id;
}

export function store(stored: Stored): void {
  stored.late = 1;
}
