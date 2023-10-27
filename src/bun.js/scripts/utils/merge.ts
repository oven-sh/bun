import { ClassDefinition } from "../class-definitions";

/** This mutates target */
export function mergeClasses(base: ClassDefinition, target: ClassDefinition) {
    target.call = target.call ?? base.call;
    target.finalize = target.finalize ?? base.finalize;
    target.klass = {
        ...base.klass,
        ...target.klass,
    };
    target.proto = {
        ...base.proto,
        ...target.proto,
    };
    target.values = target.values || [];
    target.values.push(...(base.values || []));
    target.JSType = target.JSType ?? base.JSType;
    target.noConstructor = target.noConstructor ?? base.noConstructor;
    target.estimatedSize = target.estimatedSize ?? base.estimatedSize;
    target.hasPendingActivity = target.hasPendingActivity ?? base.hasPendingActivity;
    target.isEventEmitter = target.isEventEmitter ?? base.isEventEmitter;

    target.getInternalProperties = target.getInternalProperties ?? base.getInternalProperties;

    target.custom = {
        ...(base.custom || {}),
        ...(target.custom || {}),
    }

    target.configurable = target.configurable ?? base.configurable;
    target.enumerable = target.enumerable ?? base.enumerable;
    target.structuredClone = target.structuredClone ?? base.structuredClone;

    target.extends = base.extends;
}
