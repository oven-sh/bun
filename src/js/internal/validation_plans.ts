const { validateByPlan, safeValidateByPlan, planSchema } = require("internal/validation");

const plans = new Map<string, any[]>();

function planOf(text: string): any[] {
  let plan = plans.get(text);
  if (plan === undefined) plans.set(text, (plan = JSON.parse(text)));
  return plan!;
}

export function validate(value: unknown, planText: string): unknown {
  return validateByPlan(planOf(planText), value);
}

export function safeValidate(value: unknown, planText: string): unknown {
  return safeValidateByPlan(planOf(planText), value);
}

export function parse(text: string, planText: string): unknown {
  return validateByPlan(planOf(planText), JSON.parse(text));
}

export function schema(planText: string): unknown {
  return planSchema(planOf(planText));
}
