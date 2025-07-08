export async function prompt(question: string): Promise<string> {
  console.log(question);
  return 'user input';
}

export function confirm(message: string): boolean {
  return true;
}