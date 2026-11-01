export function tell(label: string, error: unknown) {
  console.log(label + ": " + (error as Error).constructor.name + ": " + (error as Error).message);
}
