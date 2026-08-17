{
auto result = m_overloadedOperations.add("!"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Operator,
    .mustUse = true,
    .constantFunction = constantNot,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // ! :: (Bool) -> Bool
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.boolType()));
    candidate.result = allocateAbstractType(m_types.boolType());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // ! :: <N>(Vector<N, Bool>) -> Vector<N, Bool>
    OverloadCandidate candidate;
    ValueVariable N { 0 };
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(m_types.boolType()) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(m_types.boolType()) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("||"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Operator,
    .mustUse = true,
    .constantFunction = constantOr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // || :: (Bool, Bool) -> Bool
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.boolType()));
    candidate.parameters.append(allocateAbstractType(m_types.boolType()));
    candidate.result = allocateAbstractType(m_types.boolType());
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("&&"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Operator,
    .mustUse = true,
    .constantFunction = constantAnd,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // && :: (Bool, Bool) -> Bool
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.boolType()));
    candidate.parameters.append(allocateAbstractType(m_types.boolType()));
    candidate.result = allocateAbstractType(m_types.boolType());
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("|"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Operator,
    .mustUse = true,
    .constantFunction = constantBitwiseOr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // | :: (Bool, Bool) -> Bool
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.boolType()));
    candidate.parameters.append(allocateAbstractType(m_types.boolType()));
    candidate.result = allocateAbstractType(m_types.boolType());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // | :: <N>(Vector<N, Bool>, Vector<N, Bool>) -> Vector<N, Bool>
    OverloadCandidate candidate;
    ValueVariable N { 0 };
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(m_types.boolType()) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(m_types.boolType()) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(m_types.boolType()) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // | :: <T is Integer>(T, T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Integer };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // | :: <T is Integer, N>(Vector<N, T>, Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Integer };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("&"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Operator,
    .mustUse = true,
    .constantFunction = constantBitwiseAnd,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // & :: (Bool, Bool) -> Bool
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.boolType()));
    candidate.parameters.append(allocateAbstractType(m_types.boolType()));
    candidate.result = allocateAbstractType(m_types.boolType());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // & :: <N>(Vector<N, Bool>, Vector<N, Bool>) -> Vector<N, Bool>
    OverloadCandidate candidate;
    ValueVariable N { 0 };
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(m_types.boolType()) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(m_types.boolType()) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(m_types.boolType()) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // & :: <T is Integer>(T, T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Integer };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // & :: <T is Integer, N>(Vector<N, T>, Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Integer };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("-"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Operator,
    .mustUse = true,
    .constantFunction = constantMinus,
    .validationFunction = validateMinus,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // - :: <T is SignedNumber>(T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::SignedNumber };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // - :: <T is SignedNumber, N>(Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::SignedNumber };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // - :: <T is Number>(T, T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Number };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // - :: <T is Number, N>(Vector<N, T>, T) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Number };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // - :: <T is Number, N>(T, Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Number };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // - :: <T is Number, N>(Vector<N, T>, Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Number };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // - :: <T is Float, C, R>(Matrix<C, R, T>, Matrix<C, R, T>) -> Matrix<C, R, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    ValueVariable C { 0 };
    ValueVariable R { 1 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(C);
    candidate.valueVariables.append(R);
    candidate.parameters.append(allocateAbstractType(AbstractMatrix { C, R, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractMatrix { C, R, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractMatrix { C, R, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("+"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Operator,
    .mustUse = true,
    .constantFunction = constantAdd,
    .validationFunction = validateAdd,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // + :: <T is Number>(T, T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Number };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // + :: <T is Number, N>(Vector<N, T>, T) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Number };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // + :: <T is Number, N>(T, Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Number };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // + :: <T is Number, N>(Vector<N, T>, Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Number };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // + :: <T is Float, C, R>(Matrix<C, R, T>, Matrix<C, R, T>) -> Matrix<C, R, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    ValueVariable C { 0 };
    ValueVariable R { 1 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(C);
    candidate.valueVariables.append(R);
    candidate.parameters.append(allocateAbstractType(AbstractMatrix { C, R, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractMatrix { C, R, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractMatrix { C, R, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("*"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Operator,
    .mustUse = true,
    .constantFunction = constantMultiply,
    .validationFunction = validateMultiply,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // * :: <T is Number>(T, T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Number };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // * :: <T is Number, N>(Vector<N, T>, T) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Number };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // * :: <T is Number, N>(T, Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Number };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // * :: <T is Number, N>(Vector<N, T>, Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Number };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // * :: <T is Number, C, R>(Matrix<C, R, T>, T) -> Matrix<C, R, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Number };
    ValueVariable C { 0 };
    ValueVariable R { 1 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(C);
    candidate.valueVariables.append(R);
    candidate.parameters.append(allocateAbstractType(AbstractMatrix { C, R, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(AbstractMatrix { C, R, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // * :: <T is Number, C, R>(T, Matrix<C, R, T>) -> Matrix<C, R, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Number };
    ValueVariable C { 0 };
    ValueVariable R { 1 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(C);
    candidate.valueVariables.append(R);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(AbstractMatrix { C, R, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractMatrix { C, R, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // * :: <T is Float, C, R>(Matrix<C, R, T>, Vector<C, T>) -> Vector<R, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    ValueVariable C { 0 };
    ValueVariable R { 1 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(C);
    candidate.valueVariables.append(R);
    candidate.parameters.append(allocateAbstractType(AbstractMatrix { C, R, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { C, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { R, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // * :: <T is Float, C, R>(Vector<R, T>, Matrix<C, R, T>) -> Vector<C, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    ValueVariable C { 0 };
    ValueVariable R { 1 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(C);
    candidate.valueVariables.append(R);
    candidate.parameters.append(allocateAbstractType(AbstractVector { R, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractMatrix { C, R, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { C, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // * :: <T is Float, C, R, K>(Matrix<K, R, T>, Matrix<C, K, T>) -> Matrix<C, R, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    ValueVariable C { 0 };
    ValueVariable R { 1 };
    ValueVariable K { 2 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(C);
    candidate.valueVariables.append(R);
    candidate.valueVariables.append(K);
    candidate.parameters.append(allocateAbstractType(AbstractMatrix { K, R, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractMatrix { C, K, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractMatrix { C, R, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("/"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Operator,
    .mustUse = true,
    .constantFunction = constantDivide,
    .validationFunction = validateDivide,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // / :: <T is Number>(T, T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Number };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // / :: <T is Number, N>(Vector<N, T>, T) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Number };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // / :: <T is Number, N>(T, Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Number };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // / :: <T is Number, N>(Vector<N, T>, Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Number };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("%"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Operator,
    .mustUse = true,
    .constantFunction = constantModulo,
    .validationFunction = validateModulo,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // % :: <T is Number>(T, T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Number };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // % :: <T is Number, N>(Vector<N, T>, T) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Number };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // % :: <T is Number, N>(T, Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Number };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // % :: <T is Number, N>(Vector<N, T>, Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Number };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("=="_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Operator,
    .mustUse = true,
    .constantFunction = constantEqual,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // == :: <T is Scalar>(T, T) -> Bool
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Scalar };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(m_types.boolType());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // == :: <T is Scalar, N>(Vector<N, T>, Vector<N, T>) -> Vector<N, Bool>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Scalar };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(m_types.boolType()) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("!="_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Operator,
    .mustUse = true,
    .constantFunction = constantNotEqual,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // != :: <T is Scalar>(T, T) -> Bool
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Scalar };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(m_types.boolType());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // != :: <T is Scalar, N>(Vector<N, T>, Vector<N, T>) -> Vector<N, Bool>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Scalar };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(m_types.boolType()) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("<"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Operator,
    .mustUse = true,
    .constantFunction = constantLt,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // < :: <T is Number>(T, T) -> Bool
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Number };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(m_types.boolType());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // < :: <T is Number, N>(Vector<N, T>, Vector<N, T>) -> Vector<N, Bool>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Number };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(m_types.boolType()) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("<="_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Operator,
    .mustUse = true,
    .constantFunction = constantLtEq,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // <= :: <T is Number>(T, T) -> Bool
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Number };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(m_types.boolType());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // <= :: <T is Number, N>(Vector<N, T>, Vector<N, T>) -> Vector<N, Bool>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Number };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(m_types.boolType()) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add(">"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Operator,
    .mustUse = true,
    .constantFunction = constantGt,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // > :: <T is Number>(T, T) -> Bool
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Number };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(m_types.boolType());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // > :: <T is Number, N>(Vector<N, T>, Vector<N, T>) -> Vector<N, Bool>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Number };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(m_types.boolType()) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add(">="_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Operator,
    .mustUse = true,
    .constantFunction = constantGtEq,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // >= :: <T is Number>(T, T) -> Bool
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Number };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(m_types.boolType());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // >= :: <T is Number, N>(Vector<N, T>, Vector<N, T>) -> Vector<N, Bool>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Number };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(m_types.boolType()) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("~"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Operator,
    .mustUse = true,
    .constantFunction = constantBitwiseNot,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // ~ :: <T is Integer>(T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Integer };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // ~ :: <T is Integer, N>(Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Integer };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("^"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Operator,
    .mustUse = true,
    .constantFunction = constantBitwiseXor,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // ^ :: <T is Integer>(T, T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Integer };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // ^ :: <T is Integer, N>(Vector<N, T>, Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Integer };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("<<"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Operator,
    .mustUse = true,
    .constantFunction = constantBitwiseShiftLeft,
    .validationFunction = validateBitwiseShiftLeft,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // << :: <S is Integer>(S, U32) -> S
    OverloadCandidate candidate;
    TypeVariable S { 0, Constraints::Integer };
    candidate.typeVariables.append(S);
    candidate.parameters.append(allocateAbstractType(S));
    candidate.parameters.append(allocateAbstractType(m_types.u32Type()));
    candidate.result = allocateAbstractType(S);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // << :: <S is Integer, N>(Vector<N, S>, Vector<N, U32>) -> Vector<N, S>
    OverloadCandidate candidate;
    TypeVariable S { 0, Constraints::Integer };
    ValueVariable N { 0 };
    candidate.typeVariables.append(S);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(S) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(m_types.u32Type()) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(S) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add(">>"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Operator,
    .mustUse = true,
    .constantFunction = constantBitwiseShiftRight,
    .validationFunction = validateBitwiseShiftRight,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // >> :: <S is Integer>(S, U32) -> S
    OverloadCandidate candidate;
    TypeVariable S { 0, Constraints::Integer };
    candidate.typeVariables.append(S);
    candidate.parameters.append(allocateAbstractType(S));
    candidate.parameters.append(allocateAbstractType(m_types.u32Type()));
    candidate.result = allocateAbstractType(S);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // >> :: <S is Integer, N>(Vector<N, S>, Vector<N, U32>) -> Vector<N, S>
    OverloadCandidate candidate;
    TypeVariable S { 0, Constraints::Integer };
    ValueVariable N { 0 };
    candidate.typeVariables.append(S);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(S) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(m_types.u32Type()) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(S) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("bool"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Constructor,
    .mustUse = true,
    .constantFunction = constantBool,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // bool :: () -> Bool
    OverloadCandidate candidate;
    candidate.result = allocateAbstractType(m_types.boolType());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // bool :: <T is Scalar>(T) -> Bool
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Scalar };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(m_types.boolType());
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("i32"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Constructor,
    .mustUse = true,
    .constantFunction = constantI32,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // i32 :: () -> I32
    OverloadCandidate candidate;
    candidate.result = allocateAbstractType(m_types.i32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // i32 :: <T is Scalar>(T) -> I32
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Scalar };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(m_types.i32Type());
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("u32"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Constructor,
    .mustUse = true,
    .constantFunction = constantU32,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // u32 :: () -> U32
    OverloadCandidate candidate;
    candidate.result = allocateAbstractType(m_types.u32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // u32 :: <T is Scalar>(T) -> U32
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Scalar };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(m_types.u32Type());
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("f32"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Constructor,
    .mustUse = true,
    .constantFunction = constantF32,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // f32 :: () -> F32
    OverloadCandidate candidate;
    candidate.result = allocateAbstractType(m_types.f32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // f32 :: <T is Scalar>(T) -> F32
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Scalar };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(m_types.f32Type());
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("f16"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Constructor,
    .mustUse = true,
    .constantFunction = constantF16,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // f16 :: () -> F16
    OverloadCandidate candidate;
    candidate.result = allocateAbstractType(m_types.f16Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // f16 :: <T is Scalar>(T) -> F16
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Scalar };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(m_types.f16Type());
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("vec2"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Constructor,
    .mustUse = true,
    .constantFunction = constantVec2,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // vec2 :: <T is ConcreteScalar>() -> Vector<2, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteScalar };
    candidate.typeVariables.append(T);
    candidate.result = allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // vec2 :: <T is Scalar>(T) -> Vector<2, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Scalar };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // vec2 :: <T is ConcreteScalar, S is Scalar>(Vector<2, S>) -> Vector<2, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteScalar };
    TypeVariable S { 1, Constraints::Scalar };
    candidate.typeVariables.append(T);
    candidate.typeVariables.append(S);
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(S) }));
    candidate.result = allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // vec2 :: <S is Scalar>(Vector<2, S>) -> Vector<2, S>
    OverloadCandidate candidate;
    TypeVariable S { 0, Constraints::Scalar };
    candidate.typeVariables.append(S);
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(S) }));
    candidate.result = allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(S) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // vec2 :: <T is Scalar>(T, T) -> Vector<2, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Scalar };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // vec2 :: () -> vector[2, AbstractInt]
    OverloadCandidate candidate;
    candidate.result = allocateAbstractType(m_types.vectorType(2, m_types.abstractIntType()));
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("vec3"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Constructor,
    .mustUse = true,
    .constantFunction = constantVec3,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // vec3 :: <T is ConcreteScalar>() -> Vector<3, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteScalar };
    candidate.typeVariables.append(T);
    candidate.result = allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(3) }, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // vec3 :: <T is Scalar>(T) -> Vector<3, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Scalar };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(3) }, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // vec3 :: <T is ConcreteScalar, S is Scalar>(Vector<3, S>) -> Vector<3, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteScalar };
    TypeVariable S { 1, Constraints::Scalar };
    candidate.typeVariables.append(T);
    candidate.typeVariables.append(S);
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(3) }, allocateAbstractType(S) }));
    candidate.result = allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(3) }, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // vec3 :: <S is Scalar>(Vector<3, S>) -> Vector<3, S>
    OverloadCandidate candidate;
    TypeVariable S { 0, Constraints::Scalar };
    candidate.typeVariables.append(S);
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(3) }, allocateAbstractType(S) }));
    candidate.result = allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(3) }, allocateAbstractType(S) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // vec3 :: <T is Scalar>(T, T, T) -> Vector<3, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Scalar };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(3) }, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // vec3 :: <T is Scalar>(Vector<2, T>, T) -> Vector<3, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Scalar };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(3) }, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // vec3 :: <T is Scalar>(T, Vector<2, T>) -> Vector<3, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Scalar };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(3) }, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // vec3 :: () -> vector[3, AbstractInt]
    OverloadCandidate candidate;
    candidate.result = allocateAbstractType(m_types.vectorType(3, m_types.abstractIntType()));
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("vec4"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Constructor,
    .mustUse = true,
    .constantFunction = constantVec4,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // vec4 :: <T is ConcreteScalar>() -> Vector<4, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteScalar };
    candidate.typeVariables.append(T);
    candidate.result = allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // vec4 :: <T is Scalar>(T) -> Vector<4, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Scalar };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // vec4 :: <T is ConcreteScalar, S is Scalar>(Vector<4, S>) -> Vector<4, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteScalar };
    TypeVariable S { 1, Constraints::Scalar };
    candidate.typeVariables.append(T);
    candidate.typeVariables.append(S);
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(S) }));
    candidate.result = allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // vec4 :: <S is Scalar>(Vector<4, S>) -> Vector<4, S>
    OverloadCandidate candidate;
    TypeVariable S { 0, Constraints::Scalar };
    candidate.typeVariables.append(S);
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(S) }));
    candidate.result = allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(S) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // vec4 :: <T is Scalar>(T, T, T, T) -> Vector<4, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Scalar };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // vec4 :: <T is Scalar>(T, Vector<2, T>, T) -> Vector<4, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Scalar };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // vec4 :: <T is Scalar>(T, T, Vector<2, T>) -> Vector<4, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Scalar };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // vec4 :: <T is Scalar>(Vector<2, T>, T, T) -> Vector<4, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Scalar };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // vec4 :: <T is Scalar>(Vector<2, T>, Vector<2, T>) -> Vector<4, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Scalar };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // vec4 :: <T is Scalar>(Vector<3, T>, T) -> Vector<4, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Scalar };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(3) }, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // vec4 :: <T is Scalar>(T, Vector<3, T>) -> Vector<4, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Scalar };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(3) }, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // vec4 :: () -> vector[4, AbstractInt]
    OverloadCandidate candidate;
    candidate.result = allocateAbstractType(m_types.vectorType(4, m_types.abstractIntType()));
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("mat2x2"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Constructor,
    .mustUse = true,
    .constantFunction = constantMat2x2,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // mat2x2 :: <T is ConcreteFloat>() -> Matrix<2, 2, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteFloat };
    candidate.typeVariables.append(T);
    candidate.result = allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(2) }, AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // mat2x2 :: <T is ConcreteFloat, S is Float>(Matrix<2, 2, S>) -> Matrix<2, 2, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteFloat };
    TypeVariable S { 1, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.typeVariables.append(S);
    candidate.parameters.append(allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(2) }, AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(S) }));
    candidate.result = allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(2) }, AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // mat2x2 :: <T is Float>(Matrix<2, 2, T>) -> Matrix<2, 2, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(2) }, AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(2) }, AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // mat2x2 :: <T is Float>(T, T, T, T) -> Matrix<2, 2, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(2) }, AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // mat2x2 :: <T is Float>(Vector<2, T>, Vector<2, T>) -> Matrix<2, 2, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(2) }, AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("mat2x3"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Constructor,
    .mustUse = true,
    .constantFunction = constantMat2x3,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // mat2x3 :: <T is ConcreteFloat>() -> Matrix<2, 3, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteFloat };
    candidate.typeVariables.append(T);
    candidate.result = allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(2) }, AbstractValue { static_cast<unsigned>(3) }, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // mat2x3 :: <T is ConcreteFloat, S is Float>(Matrix<2, 3, S>) -> Matrix<2, 3, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteFloat };
    TypeVariable S { 1, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.typeVariables.append(S);
    candidate.parameters.append(allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(2) }, AbstractValue { static_cast<unsigned>(3) }, allocateAbstractType(S) }));
    candidate.result = allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(2) }, AbstractValue { static_cast<unsigned>(3) }, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // mat2x3 :: <T is Float>(Matrix<2, 3, T>) -> Matrix<2, 3, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(2) }, AbstractValue { static_cast<unsigned>(3) }, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(2) }, AbstractValue { static_cast<unsigned>(3) }, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // mat2x3 :: <T is Float>(T, T, T, T, T, T) -> Matrix<2, 3, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(2) }, AbstractValue { static_cast<unsigned>(3) }, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // mat2x3 :: <T is Float>(Vector<3, T>, Vector<3, T>) -> Matrix<2, 3, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(3) }, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(3) }, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(2) }, AbstractValue { static_cast<unsigned>(3) }, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("mat2x4"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Constructor,
    .mustUse = true,
    .constantFunction = constantMat2x4,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // mat2x4 :: <T is ConcreteFloat>() -> Matrix<2, 4, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteFloat };
    candidate.typeVariables.append(T);
    candidate.result = allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(2) }, AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // mat2x4 :: <T is ConcreteFloat, S is Float>(Matrix<2, 4, S>) -> Matrix<2, 4, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteFloat };
    TypeVariable S { 1, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.typeVariables.append(S);
    candidate.parameters.append(allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(2) }, AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(S) }));
    candidate.result = allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(2) }, AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // mat2x4 :: <T is Float>(Matrix<2, 4, T>) -> Matrix<2, 4, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(2) }, AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(2) }, AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // mat2x4 :: <T is Float>(T, T, T, T, T, T, T, T) -> Matrix<2, 4, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(2) }, AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // mat2x4 :: <T is Float>(Vector<4, T>, Vector<4, T>) -> Matrix<2, 4, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(2) }, AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("mat3x2"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Constructor,
    .mustUse = true,
    .constantFunction = constantMat3x2,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // mat3x2 :: <T is ConcreteFloat>() -> Matrix<3, 2, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteFloat };
    candidate.typeVariables.append(T);
    candidate.result = allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(3) }, AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // mat3x2 :: <T is ConcreteFloat, S is Float>(Matrix<3, 2, S>) -> Matrix<3, 2, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteFloat };
    TypeVariable S { 1, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.typeVariables.append(S);
    candidate.parameters.append(allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(3) }, AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(S) }));
    candidate.result = allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(3) }, AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // mat3x2 :: <T is Float>(Matrix<3, 2, T>) -> Matrix<3, 2, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(3) }, AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(3) }, AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // mat3x2 :: <T is Float>(T, T, T, T, T, T) -> Matrix<3, 2, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(3) }, AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // mat3x2 :: <T is Float>(Vector<2, T>, Vector<2, T>, Vector<2, T>) -> Matrix<3, 2, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(3) }, AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("mat3x3"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Constructor,
    .mustUse = true,
    .constantFunction = constantMat3x3,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // mat3x3 :: <T is ConcreteFloat>() -> Matrix<3, 3, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteFloat };
    candidate.typeVariables.append(T);
    candidate.result = allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(3) }, AbstractValue { static_cast<unsigned>(3) }, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // mat3x3 :: <T is ConcreteFloat, S is Float>(Matrix<3, 3, S>) -> Matrix<3, 3, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteFloat };
    TypeVariable S { 1, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.typeVariables.append(S);
    candidate.parameters.append(allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(3) }, AbstractValue { static_cast<unsigned>(3) }, allocateAbstractType(S) }));
    candidate.result = allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(3) }, AbstractValue { static_cast<unsigned>(3) }, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // mat3x3 :: <T is Float>(Matrix<3, 3, T>) -> Matrix<3, 3, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(3) }, AbstractValue { static_cast<unsigned>(3) }, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(3) }, AbstractValue { static_cast<unsigned>(3) }, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // mat3x3 :: <T is Float>(T, T, T, T, T, T, T, T, T) -> Matrix<3, 3, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(3) }, AbstractValue { static_cast<unsigned>(3) }, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // mat3x3 :: <T is Float>(Vector<3, T>, Vector<3, T>, Vector<3, T>) -> Matrix<3, 3, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(3) }, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(3) }, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(3) }, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(3) }, AbstractValue { static_cast<unsigned>(3) }, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("mat3x4"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Constructor,
    .mustUse = true,
    .constantFunction = constantMat3x4,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // mat3x4 :: <T is ConcreteFloat>() -> Matrix<3, 4, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteFloat };
    candidate.typeVariables.append(T);
    candidate.result = allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(3) }, AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // mat3x4 :: <T is ConcreteFloat, S is Float>(Matrix<3, 4, S>) -> Matrix<3, 4, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteFloat };
    TypeVariable S { 1, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.typeVariables.append(S);
    candidate.parameters.append(allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(3) }, AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(S) }));
    candidate.result = allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(3) }, AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // mat3x4 :: <T is Float>(Matrix<3, 4, T>) -> Matrix<3, 4, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(3) }, AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(3) }, AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // mat3x4 :: <T is Float>(T, T, T, T, T, T, T, T, T, T, T, T) -> Matrix<3, 4, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(3) }, AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // mat3x4 :: <T is Float>(Vector<4, T>, Vector<4, T>, Vector<4, T>) -> Matrix<3, 4, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(3) }, AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("mat4x2"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Constructor,
    .mustUse = true,
    .constantFunction = constantMat4x2,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // mat4x2 :: <T is ConcreteFloat>() -> Matrix<4, 2, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteFloat };
    candidate.typeVariables.append(T);
    candidate.result = allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(4) }, AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // mat4x2 :: <T is ConcreteFloat, S is Float>(Matrix<4, 2, S>) -> Matrix<4, 2, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteFloat };
    TypeVariable S { 1, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.typeVariables.append(S);
    candidate.parameters.append(allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(4) }, AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(S) }));
    candidate.result = allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(4) }, AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // mat4x2 :: <T is Float>(Matrix<4, 2, T>) -> Matrix<4, 2, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(4) }, AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(4) }, AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // mat4x2 :: <T is Float>(T, T, T, T, T, T, T, T) -> Matrix<4, 2, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(4) }, AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // mat4x2 :: <T is Float>(Vector<2, T>, Vector<2, T>, Vector<2, T>, Vector<2, T>) -> Matrix<4, 2, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(4) }, AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("mat4x3"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Constructor,
    .mustUse = true,
    .constantFunction = constantMat4x3,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // mat4x3 :: <T is ConcreteFloat>() -> Matrix<4, 3, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteFloat };
    candidate.typeVariables.append(T);
    candidate.result = allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(4) }, AbstractValue { static_cast<unsigned>(3) }, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // mat4x3 :: <T is ConcreteFloat, S is Float>(Matrix<4, 3, S>) -> Matrix<4, 3, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteFloat };
    TypeVariable S { 1, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.typeVariables.append(S);
    candidate.parameters.append(allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(4) }, AbstractValue { static_cast<unsigned>(3) }, allocateAbstractType(S) }));
    candidate.result = allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(4) }, AbstractValue { static_cast<unsigned>(3) }, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // mat4x3 :: <T is Float>(Matrix<4, 3, T>) -> Matrix<4, 3, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(4) }, AbstractValue { static_cast<unsigned>(3) }, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(4) }, AbstractValue { static_cast<unsigned>(3) }, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // mat4x3 :: <T is Float>(T, T, T, T, T, T, T, T, T, T, T, T) -> Matrix<4, 3, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(4) }, AbstractValue { static_cast<unsigned>(3) }, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // mat4x3 :: <T is Float>(Vector<3, T>, Vector<3, T>, Vector<3, T>, Vector<3, T>) -> Matrix<4, 3, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(3) }, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(3) }, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(3) }, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(3) }, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(4) }, AbstractValue { static_cast<unsigned>(3) }, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("mat4x4"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Constructor,
    .mustUse = true,
    .constantFunction = constantMat4x4,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // mat4x4 :: <T is ConcreteFloat>() -> Matrix<4, 4, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteFloat };
    candidate.typeVariables.append(T);
    candidate.result = allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(4) }, AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // mat4x4 :: <T is ConcreteFloat, S is Float>(Matrix<4, 4, S>) -> Matrix<4, 4, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteFloat };
    TypeVariable S { 1, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.typeVariables.append(S);
    candidate.parameters.append(allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(4) }, AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(S) }));
    candidate.result = allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(4) }, AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // mat4x4 :: <T is Float>(Matrix<4, 4, T>) -> Matrix<4, 4, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(4) }, AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(4) }, AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // mat4x4 :: <T is Float>(T, T, T, T, T, T, T, T, T, T, T, T, T, T, T, T) -> Matrix<4, 4, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(4) }, AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // mat4x4 :: <T is Float>(Vector<4, T>, Vector<4, T>, Vector<4, T>, Vector<4, T>) -> Matrix<4, 4, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractMatrix { AbstractValue { static_cast<unsigned>(4) }, AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("all"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantAll,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // all :: <N>(Vector<N, Bool>) -> Bool
    OverloadCandidate candidate;
    ValueVariable N { 0 };
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(m_types.boolType()) }));
    candidate.result = allocateAbstractType(m_types.boolType());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // all :: <N>(Bool) -> Bool
    OverloadCandidate candidate;
    ValueVariable N { 0 };
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(m_types.boolType()));
    candidate.result = allocateAbstractType(m_types.boolType());
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("any"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantAny,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // any :: <N>(Vector<N, Bool>) -> Bool
    OverloadCandidate candidate;
    ValueVariable N { 0 };
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(m_types.boolType()) }));
    candidate.result = allocateAbstractType(m_types.boolType());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // any :: <N>(Bool) -> Bool
    OverloadCandidate candidate;
    ValueVariable N { 0 };
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(m_types.boolType()));
    candidate.result = allocateAbstractType(m_types.boolType());
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("select"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantSelect,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // select :: <T is Scalar>(T, T, Bool) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Scalar };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(m_types.boolType()));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // select :: <T is Scalar, N>(Vector<N, T>, Vector<N, T>, Bool) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Scalar };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(m_types.boolType()));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // select :: <T is Scalar, N>(Vector<N, T>, Vector<N, T>, Vector<N, Bool>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Scalar };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(m_types.boolType()) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("arrayLength"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // arrayLength :: <T>(Pointer<AddressSpace::Storage, Array<T>, AccessMode::Read>) -> U32
    OverloadCandidate candidate;
    TypeVariable T { 0 };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(AbstractPointer { AbstractValue { static_cast<unsigned>(AddressSpace::Storage) }, allocateAbstractType(AbstractArray { allocateAbstractType(T) }), AbstractValue { static_cast<unsigned>(AccessMode::Read) } }));
    candidate.result = allocateAbstractType(m_types.u32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // arrayLength :: <T>(Pointer<AddressSpace::Storage, Array<T>, AccessMode::ReadWrite>) -> U32
    OverloadCandidate candidate;
    TypeVariable T { 0 };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(AbstractPointer { AbstractValue { static_cast<unsigned>(AddressSpace::Storage) }, allocateAbstractType(AbstractArray { allocateAbstractType(T) }), AbstractValue { static_cast<unsigned>(AccessMode::ReadWrite) } }));
    candidate.result = allocateAbstractType(m_types.u32Type());
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("acos"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantAcos,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // acos :: <T is Float>(T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // acos :: <T is Float, N>(Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("asin"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantAsin,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // asin :: <T is Float>(T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // asin :: <T is Float, N>(Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("atan"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantAtan,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // atan :: <T is Float>(T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // atan :: <T is Float, N>(Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("cos"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantCos,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // cos :: <T is Float>(T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // cos :: <T is Float, N>(Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("sin"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantSin,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // sin :: <T is Float>(T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // sin :: <T is Float, N>(Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("tan"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantTan,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // tan :: <T is Float>(T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // tan :: <T is Float, N>(Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("acosh"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantAcosh,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // acosh :: <T is Float>(T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // acosh :: <T is Float, N>(Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("asinh"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantAsinh,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // asinh :: <T is Float>(T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // asinh :: <T is Float, N>(Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("atanh"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantAtanh,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // atanh :: <T is Float>(T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // atanh :: <T is Float, N>(Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("cosh"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantCosh,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // cosh :: <T is Float>(T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // cosh :: <T is Float, N>(Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("sinh"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantSinh,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // sinh :: <T is Float>(T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // sinh :: <T is Float, N>(Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("tanh"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantTanh,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // tanh :: <T is Float>(T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // tanh :: <T is Float, N>(Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("abs"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantAbs,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // abs :: <T is Number>(T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Number };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // abs :: <T is Number, N>(Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Number };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("atan2"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantAtan2,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // atan2 :: <T is Float>(T, T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // atan2 :: <T is Float, N>(Vector<N, T>, Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("ceil"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantCeil,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // ceil :: <T is Float>(T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // ceil :: <T is Float, N>(Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("clamp"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantClamp,
    .validationFunction = validateClamp,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // clamp :: <T is Number>(T, T, T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Number };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // clamp :: <T is Number, N>(Vector<N, T>, Vector<N, T>, Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Number };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("countLeadingZeros"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantCountLeadingZeros,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // countLeadingZeros :: <T is ConcreteInteger>(T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // countLeadingZeros :: <T is ConcreteInteger, N>(Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("countOneBits"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantCountOneBits,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // countOneBits :: <T is ConcreteInteger>(T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // countOneBits :: <T is ConcreteInteger, N>(Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("countTrailingZeros"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantCountTrailingZeros,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // countTrailingZeros :: <T is ConcreteInteger>(T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // countTrailingZeros :: <T is ConcreteInteger, N>(Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("cross"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantCross,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // cross :: <T is Float>(Vector<3, T>, Vector<3, T>) -> Vector<3, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(3) }, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(3) }, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(3) }, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("degrees"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantDegrees,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // degrees :: <T is Float>(T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // degrees :: <T is Float, N>(Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("determinant"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantDeterminant,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // determinant :: <T is Float, C>(Matrix<C, C, T>) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    ValueVariable C { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(C);
    candidate.parameters.append(allocateAbstractType(AbstractMatrix { C, C, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("distance"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantDistance,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // distance :: <T is Float>(T, T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // distance :: <T is Float, N>(Vector<N, T>, Vector<N, T>) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("dot"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantDot,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // dot :: <T is Number, N>(Vector<N, T>, Vector<N, T>) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Number };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("dot4U8Packed"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantDot4U8Packed,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // dot4U8Packed :: (U32, U32) -> U32
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.u32Type()));
    candidate.parameters.append(allocateAbstractType(m_types.u32Type()));
    candidate.result = allocateAbstractType(m_types.u32Type());
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("dot4I8Packed"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantDot4I8Packed,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // dot4I8Packed :: (U32, U32) -> I32
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.u32Type()));
    candidate.parameters.append(allocateAbstractType(m_types.u32Type()));
    candidate.result = allocateAbstractType(m_types.i32Type());
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("exp"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantExp,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // exp :: <T is Float>(T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // exp :: <T is Float, N>(Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("exp2"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantExp2,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // exp2 :: <T is Float>(T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // exp2 :: <T is Float, N>(Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("extractBits"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantExtractBits,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // extractBits :: (I32, U32, U32) -> I32
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.i32Type()));
    candidate.parameters.append(allocateAbstractType(m_types.u32Type()));
    candidate.parameters.append(allocateAbstractType(m_types.u32Type()));
    candidate.result = allocateAbstractType(m_types.i32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // extractBits :: <N>(Vector<N, I32>, U32, U32) -> Vector<N, I32>
    OverloadCandidate candidate;
    ValueVariable N { 0 };
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(m_types.i32Type()) }));
    candidate.parameters.append(allocateAbstractType(m_types.u32Type()));
    candidate.parameters.append(allocateAbstractType(m_types.u32Type()));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(m_types.i32Type()) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // extractBits :: (U32, U32, U32) -> U32
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.u32Type()));
    candidate.parameters.append(allocateAbstractType(m_types.u32Type()));
    candidate.parameters.append(allocateAbstractType(m_types.u32Type()));
    candidate.result = allocateAbstractType(m_types.u32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // extractBits :: <N>(Vector<N, U32>, U32, U32) -> Vector<N, U32>
    OverloadCandidate candidate;
    ValueVariable N { 0 };
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(m_types.u32Type()) }));
    candidate.parameters.append(allocateAbstractType(m_types.u32Type()));
    candidate.parameters.append(allocateAbstractType(m_types.u32Type()));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(m_types.u32Type()) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("faceForward"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantFaceForward,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // faceForward :: <T is Float, N>(Vector<N, T>, Vector<N, T>, Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("firstLeadingBit"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantFirstLeadingBit,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // firstLeadingBit :: (I32) -> I32
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.i32Type()));
    candidate.result = allocateAbstractType(m_types.i32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // firstLeadingBit :: <N>(Vector<N, I32>) -> Vector<N, I32>
    OverloadCandidate candidate;
    ValueVariable N { 0 };
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(m_types.i32Type()) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(m_types.i32Type()) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // firstLeadingBit :: (U32) -> U32
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.u32Type()));
    candidate.result = allocateAbstractType(m_types.u32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // firstLeadingBit :: <N>(Vector<N, U32>) -> Vector<N, U32>
    OverloadCandidate candidate;
    ValueVariable N { 0 };
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(m_types.u32Type()) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(m_types.u32Type()) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("firstTrailingBit"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantFirstTrailingBit,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // firstTrailingBit :: <T is ConcreteInteger>(T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // firstTrailingBit :: <T is ConcreteInteger, N>(Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("floor"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantFloor,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // floor :: <T is Float>(T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // floor :: <T is Float, N>(Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("fma"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantFma,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // fma :: <T is Float>(T, T, T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // fma :: <T is Float, N>(Vector<N, T>, Vector<N, T>, Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("fract"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantFract,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // fract :: <T is Float>(T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // fract :: <T is Float, N>(Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("frexp"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantFrexp,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // frexp :: (F32) -> frexpResult[F32, I32]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.f32Type()));
    candidate.result = allocateAbstractType(m_types.frexpResultType(m_types.f32Type(), m_types.i32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // frexp :: (F16) -> frexpResult[F16, I32]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.f16Type()));
    candidate.result = allocateAbstractType(m_types.frexpResultType(m_types.f16Type(), m_types.i32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // frexp :: (AbstractFloat) -> frexpResult[AbstractFloat, AbstractInt]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.abstractFloatType()));
    candidate.result = allocateAbstractType(m_types.frexpResultType(m_types.abstractFloatType(), m_types.abstractIntType()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // frexp :: (vector[2, F32]) -> frexpResult[vector[2, F32], vector[2, I32]]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.result = allocateAbstractType(m_types.frexpResultType(m_types.vectorType(2, m_types.f32Type()), m_types.vectorType(2, m_types.i32Type())));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // frexp :: (vector[2, F16]) -> frexpResult[vector[2, F16], vector[2, I32]]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f16Type())));
    candidate.result = allocateAbstractType(m_types.frexpResultType(m_types.vectorType(2, m_types.f16Type()), m_types.vectorType(2, m_types.i32Type())));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // frexp :: (vector[2, AbstractFloat]) -> frexpResult[vector[2, AbstractFloat], vector[2, AbstractInt]]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.abstractFloatType())));
    candidate.result = allocateAbstractType(m_types.frexpResultType(m_types.vectorType(2, m_types.abstractFloatType()), m_types.vectorType(2, m_types.abstractIntType())));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // frexp :: (vector[3, F32]) -> frexpResult[vector[3, F32], vector[3, I32]]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(3, m_types.f32Type())));
    candidate.result = allocateAbstractType(m_types.frexpResultType(m_types.vectorType(3, m_types.f32Type()), m_types.vectorType(3, m_types.i32Type())));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // frexp :: (vector[3, F16]) -> frexpResult[vector[3, F16], vector[3, I32]]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(3, m_types.f16Type())));
    candidate.result = allocateAbstractType(m_types.frexpResultType(m_types.vectorType(3, m_types.f16Type()), m_types.vectorType(3, m_types.i32Type())));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // frexp :: (vector[3, AbstractFloat]) -> frexpResult[vector[3, AbstractFloat], vector[3, AbstractInt]]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(3, m_types.abstractFloatType())));
    candidate.result = allocateAbstractType(m_types.frexpResultType(m_types.vectorType(3, m_types.abstractFloatType()), m_types.vectorType(3, m_types.abstractIntType())));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // frexp :: (vector[4, F32]) -> frexpResult[vector[4, F32], vector[4, I32]]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(4, m_types.f32Type())));
    candidate.result = allocateAbstractType(m_types.frexpResultType(m_types.vectorType(4, m_types.f32Type()), m_types.vectorType(4, m_types.i32Type())));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // frexp :: (vector[4, F16]) -> frexpResult[vector[4, F16], vector[4, I32]]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(4, m_types.f16Type())));
    candidate.result = allocateAbstractType(m_types.frexpResultType(m_types.vectorType(4, m_types.f16Type()), m_types.vectorType(4, m_types.i32Type())));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // frexp :: (vector[4, AbstractFloat]) -> frexpResult[vector[4, AbstractFloat], vector[4, AbstractInt]]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(4, m_types.abstractFloatType())));
    candidate.result = allocateAbstractType(m_types.frexpResultType(m_types.vectorType(4, m_types.abstractFloatType()), m_types.vectorType(4, m_types.abstractIntType())));
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("insertBits"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantInsertBits,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // insertBits :: <T is ConcreteInteger>(T, T, U32, U32) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(m_types.u32Type()));
    candidate.parameters.append(allocateAbstractType(m_types.u32Type()));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // insertBits :: <T is ConcreteInteger, N>(Vector<N, T>, Vector<N, T>, U32, U32) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(m_types.u32Type()));
    candidate.parameters.append(allocateAbstractType(m_types.u32Type()));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("inverseSqrt"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantInverseSqrt,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // inverseSqrt :: <T is Float>(T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // inverseSqrt :: <T is Float, N>(Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("ldexp"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantLdexp,
    .validationFunction = validateLdexp,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // ldexp :: <T is ConcreteFloat>(T, I32) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteFloat };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(m_types.i32Type()));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // ldexp :: (AbstractFloat, AbstractInt) -> AbstractFloat
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.abstractFloatType()));
    candidate.parameters.append(allocateAbstractType(m_types.abstractIntType()));
    candidate.result = allocateAbstractType(m_types.abstractFloatType());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // ldexp :: (AbstractFloat, I32) -> AbstractFloat
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.abstractFloatType()));
    candidate.parameters.append(allocateAbstractType(m_types.i32Type()));
    candidate.result = allocateAbstractType(m_types.abstractFloatType());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // ldexp :: <T is ConcreteFloat, N>(Vector<N, T>, Vector<N, I32>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteFloat };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(m_types.i32Type()) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // ldexp :: <N>(Vector<N, AbstractFloat>, Vector<N, AbstractInt>) -> Vector<N, AbstractFloat>
    OverloadCandidate candidate;
    ValueVariable N { 0 };
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(m_types.abstractFloatType()) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(m_types.abstractIntType()) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(m_types.abstractFloatType()) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // ldexp :: <N>(Vector<N, AbstractFloat>, Vector<N, I32>) -> Vector<N, AbstractFloat>
    OverloadCandidate candidate;
    ValueVariable N { 0 };
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(m_types.abstractFloatType()) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(m_types.i32Type()) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(m_types.abstractFloatType()) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("length"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantLength,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // length :: <T is Float>(T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // length :: <T is Float, N>(Vector<N, T>) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("log"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantLog,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // log :: <T is Float>(T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // log :: <T is Float, N>(Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("log2"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantLog2,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // log2 :: <T is Float>(T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // log2 :: <T is Float, N>(Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("max"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantMax,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // max :: <T is Number>(T, T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Number };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // max :: <T is Number, N>(Vector<N, T>, Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Number };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("min"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantMin,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // min :: <T is Number>(T, T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Number };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // min :: <T is Number, N>(Vector<N, T>, Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Number };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("mix"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantMix,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // mix :: <T is Float>(T, T, T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // mix :: <T is Float, N>(Vector<N, T>, Vector<N, T>, Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // mix :: <T is Float, N>(Vector<N, T>, Vector<N, T>, T) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("modf"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantModf,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // modf :: (F32) -> modfResult[F32, F32]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.f32Type()));
    candidate.result = allocateAbstractType(m_types.modfResultType(m_types.f32Type(), m_types.f32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // modf :: (F16) -> modfResult[F16, F16]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.f16Type()));
    candidate.result = allocateAbstractType(m_types.modfResultType(m_types.f16Type(), m_types.f16Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // modf :: (AbstractFloat) -> modfResult[AbstractFloat, AbstractFloat]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.abstractFloatType()));
    candidate.result = allocateAbstractType(m_types.modfResultType(m_types.abstractFloatType(), m_types.abstractFloatType()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // modf :: (vector[2, F32]) -> modfResult[vector[2, F32], vector[2, F32]]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.result = allocateAbstractType(m_types.modfResultType(m_types.vectorType(2, m_types.f32Type()), m_types.vectorType(2, m_types.f32Type())));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // modf :: (vector[2, F16]) -> modfResult[vector[2, F16], vector[2, F16]]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f16Type())));
    candidate.result = allocateAbstractType(m_types.modfResultType(m_types.vectorType(2, m_types.f16Type()), m_types.vectorType(2, m_types.f16Type())));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // modf :: (vector[2, AbstractFloat]) -> modfResult[vector[2, AbstractFloat], vector[2, AbstractFloat]]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.abstractFloatType())));
    candidate.result = allocateAbstractType(m_types.modfResultType(m_types.vectorType(2, m_types.abstractFloatType()), m_types.vectorType(2, m_types.abstractFloatType())));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // modf :: (vector[3, F32]) -> modfResult[vector[3, F32], vector[3, F32]]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(3, m_types.f32Type())));
    candidate.result = allocateAbstractType(m_types.modfResultType(m_types.vectorType(3, m_types.f32Type()), m_types.vectorType(3, m_types.f32Type())));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // modf :: (vector[3, F16]) -> modfResult[vector[3, F16], vector[3, F16]]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(3, m_types.f16Type())));
    candidate.result = allocateAbstractType(m_types.modfResultType(m_types.vectorType(3, m_types.f16Type()), m_types.vectorType(3, m_types.f16Type())));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // modf :: (vector[3, AbstractFloat]) -> modfResult[vector[3, AbstractFloat], vector[3, AbstractFloat]]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(3, m_types.abstractFloatType())));
    candidate.result = allocateAbstractType(m_types.modfResultType(m_types.vectorType(3, m_types.abstractFloatType()), m_types.vectorType(3, m_types.abstractFloatType())));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // modf :: (vector[4, F32]) -> modfResult[vector[4, F32], vector[4, F32]]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(4, m_types.f32Type())));
    candidate.result = allocateAbstractType(m_types.modfResultType(m_types.vectorType(4, m_types.f32Type()), m_types.vectorType(4, m_types.f32Type())));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // modf :: (vector[4, F16]) -> modfResult[vector[4, F16], vector[4, F16]]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(4, m_types.f16Type())));
    candidate.result = allocateAbstractType(m_types.modfResultType(m_types.vectorType(4, m_types.f16Type()), m_types.vectorType(4, m_types.f16Type())));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // modf :: (vector[4, AbstractFloat]) -> modfResult[vector[4, AbstractFloat], vector[4, AbstractFloat]]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(4, m_types.abstractFloatType())));
    candidate.result = allocateAbstractType(m_types.modfResultType(m_types.vectorType(4, m_types.abstractFloatType()), m_types.vectorType(4, m_types.abstractFloatType())));
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("normalize"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantNormalize,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // normalize :: <T is Float, N>(Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("pow"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantPow,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // pow :: <T is Float>(T, T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // pow :: <T is Float, N>(Vector<N, T>, Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("quantizeToF16"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantQuantizeToF16,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // quantizeToF16 :: (F32) -> F32
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.f32Type()));
    candidate.result = allocateAbstractType(m_types.f32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // quantizeToF16 :: <N>(Vector<N, F32>) -> Vector<N, F32>
    OverloadCandidate candidate;
    ValueVariable N { 0 };
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(m_types.f32Type()) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(m_types.f32Type()) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("radians"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantRadians,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // radians :: <T is Float>(T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // radians :: <T is Float, N>(Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("reflect"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantReflect,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // reflect :: <T is Float, N>(Vector<N, T>, Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("refract"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantRefract,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // refract :: <T is Float, N>(Vector<N, T>, Vector<N, T>, T) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("reverseBits"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantReverseBits,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // reverseBits :: <T is ConcreteInteger>(T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // reverseBits :: <T is ConcreteInteger, N>(Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("round"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantRound,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // round :: <T is Float>(T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // round :: <T is Float, N>(Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("saturate"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantSaturate,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // saturate :: <T is Float>(T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // saturate :: <T is Float, N>(Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("sign"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantSign,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // sign :: <T is SignedNumber>(T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::SignedNumber };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // sign :: <T is SignedNumber, N>(Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::SignedNumber };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("smoothstep"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantSmoothstep,
    .validationFunction = validateSmoothstep,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // smoothstep :: <T is Float>(T, T, T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // smoothstep :: <T is Float, N>(Vector<N, T>, Vector<N, T>, Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("sqrt"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantSqrt,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // sqrt :: <T is Float>(T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // sqrt :: <T is Float, N>(Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("step"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantStep,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // step :: <T is Float>(T, T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // step :: <T is Float, N>(Vector<N, T>, Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("transpose"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantTranspose,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // transpose :: <T is Float, C, R>(Matrix<C, R, T>) -> Matrix<R, C, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    ValueVariable C { 0 };
    ValueVariable R { 1 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(C);
    candidate.valueVariables.append(R);
    candidate.parameters.append(allocateAbstractType(AbstractMatrix { C, R, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractMatrix { R, C, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("trunc"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantTrunc,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // trunc :: <T is Float>(T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // trunc :: <T is Float, N>(Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::Float };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("dpdx"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // dpdx :: (F32) -> F32
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.f32Type()));
    candidate.result = allocateAbstractType(m_types.f32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // dpdx :: <N>(Vector<N, F32>) -> Vector<N, F32>
    OverloadCandidate candidate;
    ValueVariable N { 0 };
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(m_types.f32Type()) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(m_types.f32Type()) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("dpdxCoarse"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // dpdxCoarse :: (F32) -> F32
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.f32Type()));
    candidate.result = allocateAbstractType(m_types.f32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // dpdxCoarse :: <N>(Vector<N, F32>) -> Vector<N, F32>
    OverloadCandidate candidate;
    ValueVariable N { 0 };
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(m_types.f32Type()) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(m_types.f32Type()) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("dpdxFine"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // dpdxFine :: (F32) -> F32
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.f32Type()));
    candidate.result = allocateAbstractType(m_types.f32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // dpdxFine :: <N>(Vector<N, F32>) -> Vector<N, F32>
    OverloadCandidate candidate;
    ValueVariable N { 0 };
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(m_types.f32Type()) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(m_types.f32Type()) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("dpdy"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // dpdy :: (F32) -> F32
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.f32Type()));
    candidate.result = allocateAbstractType(m_types.f32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // dpdy :: <N>(Vector<N, F32>) -> Vector<N, F32>
    OverloadCandidate candidate;
    ValueVariable N { 0 };
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(m_types.f32Type()) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(m_types.f32Type()) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("dpdyCoarse"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // dpdyCoarse :: (F32) -> F32
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.f32Type()));
    candidate.result = allocateAbstractType(m_types.f32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // dpdyCoarse :: <N>(Vector<N, F32>) -> Vector<N, F32>
    OverloadCandidate candidate;
    ValueVariable N { 0 };
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(m_types.f32Type()) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(m_types.f32Type()) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("dpdyFine"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // dpdyFine :: (F32) -> F32
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.f32Type()));
    candidate.result = allocateAbstractType(m_types.f32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // dpdyFine :: <N>(Vector<N, F32>) -> Vector<N, F32>
    OverloadCandidate candidate;
    ValueVariable N { 0 };
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(m_types.f32Type()) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(m_types.f32Type()) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("fwidth"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // fwidth :: (F32) -> F32
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.f32Type()));
    candidate.result = allocateAbstractType(m_types.f32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // fwidth :: <N>(Vector<N, F32>) -> Vector<N, F32>
    OverloadCandidate candidate;
    ValueVariable N { 0 };
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(m_types.f32Type()) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(m_types.f32Type()) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("fwidthCoarse"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // fwidthCoarse :: (F32) -> F32
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.f32Type()));
    candidate.result = allocateAbstractType(m_types.f32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // fwidthCoarse :: <N>(Vector<N, F32>) -> Vector<N, F32>
    OverloadCandidate candidate;
    ValueVariable N { 0 };
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(m_types.f32Type()) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(m_types.f32Type()) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("fwidthFine"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // fwidthFine :: (F32) -> F32
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.f32Type()));
    candidate.result = allocateAbstractType(m_types.f32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // fwidthFine :: <N>(Vector<N, F32>) -> Vector<N, F32>
    OverloadCandidate candidate;
    ValueVariable N { 0 };
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(m_types.f32Type()) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(m_types.f32Type()) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("textureDimensions"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureDimensions :: <S is Concrete32BitNumber>(Texture<Types::Texture::Kind::Texture1d, S>) -> U32
    OverloadCandidate candidate;
    TypeVariable S { 0, Constraints::Concrete32BitNumber };
    candidate.typeVariables.append(S);
    candidate.parameters.append(allocateAbstractType(AbstractTexture { Types::Texture::Kind::Texture1d, allocateAbstractType(S) }));
    candidate.result = allocateAbstractType(m_types.u32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureDimensions :: <F, AM>(TextureStorage<Types::TextureStorage::Kind::TextureStorage1d, F, AM>) -> U32
    OverloadCandidate candidate;
    ValueVariable F { 0 };
    ValueVariable AM { 1 };
    candidate.valueVariables.append(F);
    candidate.valueVariables.append(AM);
    candidate.parameters.append(allocateAbstractType(AbstractTextureStorage { Types::TextureStorage::Kind::TextureStorage1d, F, AM }));
    candidate.result = allocateAbstractType(m_types.u32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureDimensions :: <S is Concrete32BitNumber, T is ConcreteInteger>(Texture<Types::Texture::Kind::Texture1d, S>, T) -> U32
    OverloadCandidate candidate;
    TypeVariable S { 0, Constraints::Concrete32BitNumber };
    TypeVariable T { 1, Constraints::ConcreteInteger };
    candidate.typeVariables.append(S);
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(AbstractTexture { Types::Texture::Kind::Texture1d, allocateAbstractType(S) }));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(m_types.u32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureDimensions :: <S is Concrete32BitNumber>(Texture<Types::Texture::Kind::Texture2d, S>) -> vector[2, U32]
    OverloadCandidate candidate;
    TypeVariable S { 0, Constraints::Concrete32BitNumber };
    candidate.typeVariables.append(S);
    candidate.parameters.append(allocateAbstractType(AbstractTexture { Types::Texture::Kind::Texture2d, allocateAbstractType(S) }));
    candidate.result = allocateAbstractType(m_types.vectorType(2, m_types.u32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureDimensions :: <S is Concrete32BitNumber>(Texture<Types::Texture::Kind::Texture2dArray, S>) -> vector[2, U32]
    OverloadCandidate candidate;
    TypeVariable S { 0, Constraints::Concrete32BitNumber };
    candidate.typeVariables.append(S);
    candidate.parameters.append(allocateAbstractType(AbstractTexture { Types::Texture::Kind::Texture2dArray, allocateAbstractType(S) }));
    candidate.result = allocateAbstractType(m_types.vectorType(2, m_types.u32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureDimensions :: <S is Concrete32BitNumber>(Texture<Types::Texture::Kind::TextureCube, S>) -> vector[2, U32]
    OverloadCandidate candidate;
    TypeVariable S { 0, Constraints::Concrete32BitNumber };
    candidate.typeVariables.append(S);
    candidate.parameters.append(allocateAbstractType(AbstractTexture { Types::Texture::Kind::TextureCube, allocateAbstractType(S) }));
    candidate.result = allocateAbstractType(m_types.vectorType(2, m_types.u32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureDimensions :: <S is Concrete32BitNumber>(Texture<Types::Texture::Kind::TextureCubeArray, S>) -> vector[2, U32]
    OverloadCandidate candidate;
    TypeVariable S { 0, Constraints::Concrete32BitNumber };
    candidate.typeVariables.append(S);
    candidate.parameters.append(allocateAbstractType(AbstractTexture { Types::Texture::Kind::TextureCubeArray, allocateAbstractType(S) }));
    candidate.result = allocateAbstractType(m_types.vectorType(2, m_types.u32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureDimensions :: <S is Concrete32BitNumber>(Texture<Types::Texture::Kind::TextureMultisampled2d, S>) -> vector[2, U32]
    OverloadCandidate candidate;
    TypeVariable S { 0, Constraints::Concrete32BitNumber };
    candidate.typeVariables.append(S);
    candidate.parameters.append(allocateAbstractType(AbstractTexture { Types::Texture::Kind::TextureMultisampled2d, allocateAbstractType(S) }));
    candidate.result = allocateAbstractType(m_types.vectorType(2, m_types.u32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureDimensions :: (TextureDepth2d) -> vector[2, U32]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.textureDepth2dType()));
    candidate.result = allocateAbstractType(m_types.vectorType(2, m_types.u32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureDimensions :: (TextureDepth2dArray) -> vector[2, U32]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.textureDepth2dArrayType()));
    candidate.result = allocateAbstractType(m_types.vectorType(2, m_types.u32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureDimensions :: (TextureDepthCube) -> vector[2, U32]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.textureDepthCubeType()));
    candidate.result = allocateAbstractType(m_types.vectorType(2, m_types.u32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureDimensions :: (TextureDepthCubeArray) -> vector[2, U32]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.textureDepthCubeArrayType()));
    candidate.result = allocateAbstractType(m_types.vectorType(2, m_types.u32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureDimensions :: (TextureDepthMultisampled2d) -> vector[2, U32]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.textureDepthMultisampled2dType()));
    candidate.result = allocateAbstractType(m_types.vectorType(2, m_types.u32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureDimensions :: <F, AM>(TextureStorage<Types::TextureStorage::Kind::TextureStorage2d, F, AM>) -> vector[2, U32]
    OverloadCandidate candidate;
    ValueVariable F { 0 };
    ValueVariable AM { 1 };
    candidate.valueVariables.append(F);
    candidate.valueVariables.append(AM);
    candidate.parameters.append(allocateAbstractType(AbstractTextureStorage { Types::TextureStorage::Kind::TextureStorage2d, F, AM }));
    candidate.result = allocateAbstractType(m_types.vectorType(2, m_types.u32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureDimensions :: <F, AM>(TextureStorage<Types::TextureStorage::Kind::TextureStorage2dArray, F, AM>) -> vector[2, U32]
    OverloadCandidate candidate;
    ValueVariable F { 0 };
    ValueVariable AM { 1 };
    candidate.valueVariables.append(F);
    candidate.valueVariables.append(AM);
    candidate.parameters.append(allocateAbstractType(AbstractTextureStorage { Types::TextureStorage::Kind::TextureStorage2dArray, F, AM }));
    candidate.result = allocateAbstractType(m_types.vectorType(2, m_types.u32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureDimensions :: (TextureExternal) -> vector[2, U32]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.textureExternalType()));
    candidate.result = allocateAbstractType(m_types.vectorType(2, m_types.u32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureDimensions :: <S is Concrete32BitNumber, T is ConcreteInteger>(Texture<Types::Texture::Kind::Texture2d, S>, T) -> vector[2, U32]
    OverloadCandidate candidate;
    TypeVariable S { 0, Constraints::Concrete32BitNumber };
    TypeVariable T { 1, Constraints::ConcreteInteger };
    candidate.typeVariables.append(S);
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(AbstractTexture { Types::Texture::Kind::Texture2d, allocateAbstractType(S) }));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(m_types.vectorType(2, m_types.u32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureDimensions :: <S is Concrete32BitNumber, T is ConcreteInteger>(Texture<Types::Texture::Kind::Texture2dArray, S>, T) -> vector[2, U32]
    OverloadCandidate candidate;
    TypeVariable S { 0, Constraints::Concrete32BitNumber };
    TypeVariable T { 1, Constraints::ConcreteInteger };
    candidate.typeVariables.append(S);
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(AbstractTexture { Types::Texture::Kind::Texture2dArray, allocateAbstractType(S) }));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(m_types.vectorType(2, m_types.u32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureDimensions :: <S is Concrete32BitNumber, T is ConcreteInteger>(Texture<Types::Texture::Kind::TextureCube, S>, T) -> vector[2, U32]
    OverloadCandidate candidate;
    TypeVariable S { 0, Constraints::Concrete32BitNumber };
    TypeVariable T { 1, Constraints::ConcreteInteger };
    candidate.typeVariables.append(S);
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(AbstractTexture { Types::Texture::Kind::TextureCube, allocateAbstractType(S) }));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(m_types.vectorType(2, m_types.u32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureDimensions :: <S is Concrete32BitNumber, T is ConcreteInteger>(Texture<Types::Texture::Kind::TextureCubeArray, S>, T) -> vector[2, U32]
    OverloadCandidate candidate;
    TypeVariable S { 0, Constraints::Concrete32BitNumber };
    TypeVariable T { 1, Constraints::ConcreteInteger };
    candidate.typeVariables.append(S);
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(AbstractTexture { Types::Texture::Kind::TextureCubeArray, allocateAbstractType(S) }));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(m_types.vectorType(2, m_types.u32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureDimensions :: <T is ConcreteInteger>(TextureDepth2d, T) -> vector[2, U32]
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(m_types.textureDepth2dType()));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(m_types.vectorType(2, m_types.u32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureDimensions :: <T is ConcreteInteger>(TextureDepth2dArray, T) -> vector[2, U32]
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(m_types.textureDepth2dArrayType()));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(m_types.vectorType(2, m_types.u32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureDimensions :: <T is ConcreteInteger>(TextureDepthCube, T) -> vector[2, U32]
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(m_types.textureDepthCubeType()));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(m_types.vectorType(2, m_types.u32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureDimensions :: <T is ConcreteInteger>(TextureDepthCubeArray, T) -> vector[2, U32]
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(m_types.textureDepthCubeArrayType()));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(m_types.vectorType(2, m_types.u32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureDimensions :: <S is Concrete32BitNumber>(Texture<Types::Texture::Kind::Texture3d, S>) -> vector[3, U32]
    OverloadCandidate candidate;
    TypeVariable S { 0, Constraints::Concrete32BitNumber };
    candidate.typeVariables.append(S);
    candidate.parameters.append(allocateAbstractType(AbstractTexture { Types::Texture::Kind::Texture3d, allocateAbstractType(S) }));
    candidate.result = allocateAbstractType(m_types.vectorType(3, m_types.u32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureDimensions :: <F, AM>(TextureStorage<Types::TextureStorage::Kind::TextureStorage3d, F, AM>) -> vector[3, U32]
    OverloadCandidate candidate;
    ValueVariable F { 0 };
    ValueVariable AM { 1 };
    candidate.valueVariables.append(F);
    candidate.valueVariables.append(AM);
    candidate.parameters.append(allocateAbstractType(AbstractTextureStorage { Types::TextureStorage::Kind::TextureStorage3d, F, AM }));
    candidate.result = allocateAbstractType(m_types.vectorType(3, m_types.u32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureDimensions :: <S is Concrete32BitNumber, T is ConcreteInteger>(Texture<Types::Texture::Kind::Texture3d, S>, T) -> vector[3, U32]
    OverloadCandidate candidate;
    TypeVariable S { 0, Constraints::Concrete32BitNumber };
    TypeVariable T { 1, Constraints::ConcreteInteger };
    candidate.typeVariables.append(S);
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(AbstractTexture { Types::Texture::Kind::Texture3d, allocateAbstractType(S) }));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(m_types.vectorType(3, m_types.u32Type()));
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("textureGather"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureGather :: <T is ConcreteInteger, S is Concrete32BitNumber>(T, Texture<Types::Texture::Kind::Texture2d, S>, Sampler, vector[2, F32]) -> Vector<4, S>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    TypeVariable S { 1, Constraints::Concrete32BitNumber };
    candidate.typeVariables.append(T);
    candidate.typeVariables.append(S);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(AbstractTexture { Types::Texture::Kind::Texture2d, allocateAbstractType(S) }));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.result = allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(S) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureGather :: <T is ConcreteInteger, S is Concrete32BitNumber>(T, Texture<Types::Texture::Kind::Texture2d, S>, Sampler, vector[2, F32], vector[2, I32]) -> Vector<4, S>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    TypeVariable S { 1, Constraints::Concrete32BitNumber };
    candidate.typeVariables.append(T);
    candidate.typeVariables.append(S);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(AbstractTexture { Types::Texture::Kind::Texture2d, allocateAbstractType(S) }));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.i32Type())));
    candidate.result = allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(S) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureGather :: <T is ConcreteInteger, S is Concrete32BitNumber, U is ConcreteInteger>(T, Texture<Types::Texture::Kind::Texture2dArray, S>, Sampler, vector[2, F32], U) -> Vector<4, S>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    TypeVariable S { 1, Constraints::Concrete32BitNumber };
    TypeVariable U { 2, Constraints::ConcreteInteger };
    candidate.typeVariables.append(T);
    candidate.typeVariables.append(S);
    candidate.typeVariables.append(U);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(AbstractTexture { Types::Texture::Kind::Texture2dArray, allocateAbstractType(S) }));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(U));
    candidate.result = allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(S) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureGather :: <T is ConcreteInteger, S is Concrete32BitNumber, U is ConcreteInteger>(T, Texture<Types::Texture::Kind::Texture2dArray, S>, Sampler, vector[2, F32], U, vector[2, I32]) -> Vector<4, S>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    TypeVariable S { 1, Constraints::Concrete32BitNumber };
    TypeVariable U { 2, Constraints::ConcreteInteger };
    candidate.typeVariables.append(T);
    candidate.typeVariables.append(S);
    candidate.typeVariables.append(U);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(AbstractTexture { Types::Texture::Kind::Texture2dArray, allocateAbstractType(S) }));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(U));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.i32Type())));
    candidate.result = allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(S) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureGather :: <T is ConcreteInteger, S is Concrete32BitNumber>(T, Texture<Types::Texture::Kind::TextureCube, S>, Sampler, vector[3, F32]) -> Vector<4, S>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    TypeVariable S { 1, Constraints::Concrete32BitNumber };
    candidate.typeVariables.append(T);
    candidate.typeVariables.append(S);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(AbstractTexture { Types::Texture::Kind::TextureCube, allocateAbstractType(S) }));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(3, m_types.f32Type())));
    candidate.result = allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(S) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureGather :: <T is ConcreteInteger, S is Concrete32BitNumber, U is ConcreteInteger>(T, Texture<Types::Texture::Kind::TextureCubeArray, S>, Sampler, vector[3, F32], U) -> Vector<4, S>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    TypeVariable S { 1, Constraints::Concrete32BitNumber };
    TypeVariable U { 2, Constraints::ConcreteInteger };
    candidate.typeVariables.append(T);
    candidate.typeVariables.append(S);
    candidate.typeVariables.append(U);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(AbstractTexture { Types::Texture::Kind::TextureCubeArray, allocateAbstractType(S) }));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(3, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(U));
    candidate.result = allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(S) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureGather :: (TextureDepth2d, Sampler, vector[2, F32]) -> vector[4, F32]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.textureDepth2dType()));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.result = allocateAbstractType(m_types.vectorType(4, m_types.f32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureGather :: (TextureDepth2d, Sampler, vector[2, F32], vector[2, I32]) -> vector[4, F32]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.textureDepth2dType()));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.i32Type())));
    candidate.result = allocateAbstractType(m_types.vectorType(4, m_types.f32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureGather :: (TextureDepthCube, Sampler, vector[3, F32]) -> vector[4, F32]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.textureDepthCubeType()));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(3, m_types.f32Type())));
    candidate.result = allocateAbstractType(m_types.vectorType(4, m_types.f32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureGather :: <U is ConcreteInteger>(TextureDepth2dArray, Sampler, vector[2, F32], U) -> vector[4, F32]
    OverloadCandidate candidate;
    TypeVariable U { 0, Constraints::ConcreteInteger };
    candidate.typeVariables.append(U);
    candidate.parameters.append(allocateAbstractType(m_types.textureDepth2dArrayType()));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(U));
    candidate.result = allocateAbstractType(m_types.vectorType(4, m_types.f32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureGather :: <U is ConcreteInteger>(TextureDepth2dArray, Sampler, vector[2, F32], U, vector[2, I32]) -> vector[4, F32]
    OverloadCandidate candidate;
    TypeVariable U { 0, Constraints::ConcreteInteger };
    candidate.typeVariables.append(U);
    candidate.parameters.append(allocateAbstractType(m_types.textureDepth2dArrayType()));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(U));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.i32Type())));
    candidate.result = allocateAbstractType(m_types.vectorType(4, m_types.f32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureGather :: <U is ConcreteInteger>(TextureDepthCubeArray, Sampler, vector[3, F32], U) -> vector[4, F32]
    OverloadCandidate candidate;
    TypeVariable U { 0, Constraints::ConcreteInteger };
    candidate.typeVariables.append(U);
    candidate.parameters.append(allocateAbstractType(m_types.textureDepthCubeArrayType()));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(3, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(U));
    candidate.result = allocateAbstractType(m_types.vectorType(4, m_types.f32Type()));
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("textureGatherCompare"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureGatherCompare :: (TextureDepth2d, SamplerComparison, vector[2, F32], F32) -> vector[4, F32]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.textureDepth2dType()));
    candidate.parameters.append(allocateAbstractType(m_types.samplerComparisonType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.f32Type()));
    candidate.result = allocateAbstractType(m_types.vectorType(4, m_types.f32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureGatherCompare :: (TextureDepth2d, SamplerComparison, vector[2, F32], F32, vector[2, I32]) -> vector[4, F32]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.textureDepth2dType()));
    candidate.parameters.append(allocateAbstractType(m_types.samplerComparisonType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.f32Type()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.i32Type())));
    candidate.result = allocateAbstractType(m_types.vectorType(4, m_types.f32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureGatherCompare :: <T is ConcreteInteger>(TextureDepth2dArray, SamplerComparison, vector[2, F32], T, F32) -> vector[4, F32]
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(m_types.textureDepth2dArrayType()));
    candidate.parameters.append(allocateAbstractType(m_types.samplerComparisonType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(m_types.f32Type()));
    candidate.result = allocateAbstractType(m_types.vectorType(4, m_types.f32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureGatherCompare :: <T is ConcreteInteger>(TextureDepth2dArray, SamplerComparison, vector[2, F32], T, F32, vector[2, I32]) -> vector[4, F32]
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(m_types.textureDepth2dArrayType()));
    candidate.parameters.append(allocateAbstractType(m_types.samplerComparisonType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(m_types.f32Type()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.i32Type())));
    candidate.result = allocateAbstractType(m_types.vectorType(4, m_types.f32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureGatherCompare :: (TextureDepthCube, SamplerComparison, vector[3, F32], F32) -> vector[4, F32]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.textureDepthCubeType()));
    candidate.parameters.append(allocateAbstractType(m_types.samplerComparisonType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(3, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.f32Type()));
    candidate.result = allocateAbstractType(m_types.vectorType(4, m_types.f32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureGatherCompare :: <T is ConcreteInteger>(TextureDepthCubeArray, SamplerComparison, vector[3, F32], T, F32) -> vector[4, F32]
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(m_types.textureDepthCubeArrayType()));
    candidate.parameters.append(allocateAbstractType(m_types.samplerComparisonType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(3, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(m_types.f32Type()));
    candidate.result = allocateAbstractType(m_types.vectorType(4, m_types.f32Type()));
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("textureLoad"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureLoad :: <T is ConcreteInteger, U is ConcreteInteger, S is Concrete32BitNumber>(Texture<Types::Texture::Kind::Texture1d, S>, T, U) -> Vector<4, S>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    TypeVariable U { 1, Constraints::ConcreteInteger };
    TypeVariable S { 2, Constraints::Concrete32BitNumber };
    candidate.typeVariables.append(T);
    candidate.typeVariables.append(U);
    candidate.typeVariables.append(S);
    candidate.parameters.append(allocateAbstractType(AbstractTexture { Types::Texture::Kind::Texture1d, allocateAbstractType(S) }));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(U));
    candidate.result = allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(S) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureLoad :: <F, T is ConcreteInteger, U is ConcreteInteger, S is Concrete32BitNumber>(TextureStorage<Types::TextureStorage::Kind::TextureStorage1d, F, AccessMode::Read>, T) -> Vector<4, ChannelFormat<F>>
    OverloadCandidate candidate;
    ValueVariable F { 0 };
    TypeVariable T { 0, Constraints::ConcreteInteger };
    TypeVariable U { 1, Constraints::ConcreteInteger };
    TypeVariable S { 2, Constraints::Concrete32BitNumber };
    candidate.valueVariables.append(F);
    candidate.typeVariables.append(T);
    candidate.typeVariables.append(U);
    candidate.typeVariables.append(S);
    candidate.parameters.append(allocateAbstractType(AbstractTextureStorage { Types::TextureStorage::Kind::TextureStorage1d, F, AbstractValue { static_cast<unsigned>(AccessMode::Read) } }));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(AbstractChannelFormat { F }) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureLoad :: <F, T is ConcreteInteger, U is ConcreteInteger, S is Concrete32BitNumber>(TextureStorage<Types::TextureStorage::Kind::TextureStorage1d, F, AccessMode::ReadWrite>, T) -> Vector<4, ChannelFormat<F>>
    OverloadCandidate candidate;
    ValueVariable F { 0 };
    TypeVariable T { 0, Constraints::ConcreteInteger };
    TypeVariable U { 1, Constraints::ConcreteInteger };
    TypeVariable S { 2, Constraints::Concrete32BitNumber };
    candidate.valueVariables.append(F);
    candidate.typeVariables.append(T);
    candidate.typeVariables.append(U);
    candidate.typeVariables.append(S);
    candidate.parameters.append(allocateAbstractType(AbstractTextureStorage { Types::TextureStorage::Kind::TextureStorage1d, F, AbstractValue { static_cast<unsigned>(AccessMode::ReadWrite) } }));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(AbstractChannelFormat { F }) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureLoad :: <T is ConcreteInteger, U is ConcreteInteger, S is Concrete32BitNumber>(Texture<Types::Texture::Kind::Texture2d, S>, Vector<2, T>, U) -> Vector<4, S>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    TypeVariable U { 1, Constraints::ConcreteInteger };
    TypeVariable S { 2, Constraints::Concrete32BitNumber };
    candidate.typeVariables.append(T);
    candidate.typeVariables.append(U);
    candidate.typeVariables.append(S);
    candidate.parameters.append(allocateAbstractType(AbstractTexture { Types::Texture::Kind::Texture2d, allocateAbstractType(S) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(U));
    candidate.result = allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(S) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureLoad :: <T is ConcreteInteger, V is ConcreteInteger, U is ConcreteInteger, S is Concrete32BitNumber>(Texture<Types::Texture::Kind::Texture2dArray, S>, Vector<2, T>, V, U) -> Vector<4, S>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    TypeVariable V { 1, Constraints::ConcreteInteger };
    TypeVariable U { 2, Constraints::ConcreteInteger };
    TypeVariable S { 3, Constraints::Concrete32BitNumber };
    candidate.typeVariables.append(T);
    candidate.typeVariables.append(V);
    candidate.typeVariables.append(U);
    candidate.typeVariables.append(S);
    candidate.parameters.append(allocateAbstractType(AbstractTexture { Types::Texture::Kind::Texture2dArray, allocateAbstractType(S) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(V));
    candidate.parameters.append(allocateAbstractType(U));
    candidate.result = allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(S) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureLoad :: <T is ConcreteInteger, U is ConcreteInteger, S is Concrete32BitNumber>(Texture<Types::Texture::Kind::Texture3d, S>, Vector<3, T>, U) -> Vector<4, S>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    TypeVariable U { 1, Constraints::ConcreteInteger };
    TypeVariable S { 2, Constraints::Concrete32BitNumber };
    candidate.typeVariables.append(T);
    candidate.typeVariables.append(U);
    candidate.typeVariables.append(S);
    candidate.parameters.append(allocateAbstractType(AbstractTexture { Types::Texture::Kind::Texture3d, allocateAbstractType(S) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(3) }, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(U));
    candidate.result = allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(S) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureLoad :: <T is ConcreteInteger, U is ConcreteInteger, S is Concrete32BitNumber>(Texture<Types::Texture::Kind::TextureMultisampled2d, S>, Vector<2, T>, U) -> Vector<4, S>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    TypeVariable U { 1, Constraints::ConcreteInteger };
    TypeVariable S { 2, Constraints::Concrete32BitNumber };
    candidate.typeVariables.append(T);
    candidate.typeVariables.append(U);
    candidate.typeVariables.append(S);
    candidate.parameters.append(allocateAbstractType(AbstractTexture { Types::Texture::Kind::TextureMultisampled2d, allocateAbstractType(S) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(U));
    candidate.result = allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(S) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureLoad :: <T is ConcreteInteger, U is ConcreteInteger>(TextureDepth2d, Vector<2, T>, U) -> F32
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    TypeVariable U { 1, Constraints::ConcreteInteger };
    candidate.typeVariables.append(T);
    candidate.typeVariables.append(U);
    candidate.parameters.append(allocateAbstractType(m_types.textureDepth2dType()));
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(U));
    candidate.result = allocateAbstractType(m_types.f32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureLoad :: <T is ConcreteInteger, S is ConcreteInteger, U is ConcreteInteger>(TextureDepth2dArray, Vector<2, T>, S, U) -> F32
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    TypeVariable S { 1, Constraints::ConcreteInteger };
    TypeVariable U { 2, Constraints::ConcreteInteger };
    candidate.typeVariables.append(T);
    candidate.typeVariables.append(S);
    candidate.typeVariables.append(U);
    candidate.parameters.append(allocateAbstractType(m_types.textureDepth2dArrayType()));
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(S));
    candidate.parameters.append(allocateAbstractType(U));
    candidate.result = allocateAbstractType(m_types.f32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureLoad :: <T is ConcreteInteger, U is ConcreteInteger>(TextureDepthMultisampled2d, Vector<2, T>, U) -> F32
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    TypeVariable U { 1, Constraints::ConcreteInteger };
    candidate.typeVariables.append(T);
    candidate.typeVariables.append(U);
    candidate.parameters.append(allocateAbstractType(m_types.textureDepthMultisampled2dType()));
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(U));
    candidate.result = allocateAbstractType(m_types.f32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureLoad :: <T is ConcreteInteger>(TextureExternal, Vector<2, T>) -> vector[4, F32]
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(m_types.textureExternalType()));
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(m_types.vectorType(4, m_types.f32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureLoad :: <F, AM, T is ConcreteInteger>(TextureStorage<Types::TextureStorage::Kind::TextureStorage2d, F, AM>, Vector<2, T>) -> Vector<4, ChannelFormat<F>>
    OverloadCandidate candidate;
    ValueVariable F { 0 };
    ValueVariable AM { 1 };
    TypeVariable T { 0, Constraints::ConcreteInteger };
    candidate.valueVariables.append(F);
    candidate.valueVariables.append(AM);
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(AbstractTextureStorage { Types::TextureStorage::Kind::TextureStorage2d, F, AM }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(AbstractChannelFormat { F }) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureLoad :: <F, AM, T is ConcreteInteger, S is ConcreteInteger>(TextureStorage<Types::TextureStorage::Kind::TextureStorage2dArray, F, AM>, Vector<2, T>, S) -> Vector<4, ChannelFormat<F>>
    OverloadCandidate candidate;
    ValueVariable F { 0 };
    ValueVariable AM { 1 };
    TypeVariable T { 0, Constraints::ConcreteInteger };
    TypeVariable S { 1, Constraints::ConcreteInteger };
    candidate.valueVariables.append(F);
    candidate.valueVariables.append(AM);
    candidate.typeVariables.append(T);
    candidate.typeVariables.append(S);
    candidate.parameters.append(allocateAbstractType(AbstractTextureStorage { Types::TextureStorage::Kind::TextureStorage2dArray, F, AM }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(S));
    candidate.result = allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(AbstractChannelFormat { F }) });
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureLoad :: <F, AM, T is ConcreteInteger>(TextureStorage<Types::TextureStorage::Kind::TextureStorage3d, F, AM>, Vector<3, T>) -> Vector<4, ChannelFormat<F>>
    OverloadCandidate candidate;
    ValueVariable F { 0 };
    ValueVariable AM { 1 };
    TypeVariable T { 0, Constraints::ConcreteInteger };
    candidate.valueVariables.append(F);
    candidate.valueVariables.append(AM);
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(AbstractTextureStorage { Types::TextureStorage::Kind::TextureStorage3d, F, AM }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(3) }, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(AbstractChannelFormat { F }) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("textureNumLayers"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureNumLayers :: <S is Concrete32BitNumber>(Texture<Types::Texture::Kind::Texture2dArray, S>) -> U32
    OverloadCandidate candidate;
    TypeVariable S { 0, Constraints::Concrete32BitNumber };
    candidate.typeVariables.append(S);
    candidate.parameters.append(allocateAbstractType(AbstractTexture { Types::Texture::Kind::Texture2dArray, allocateAbstractType(S) }));
    candidate.result = allocateAbstractType(m_types.u32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureNumLayers :: <S is Concrete32BitNumber>(Texture<Types::Texture::Kind::TextureCubeArray, S>) -> U32
    OverloadCandidate candidate;
    TypeVariable S { 0, Constraints::Concrete32BitNumber };
    candidate.typeVariables.append(S);
    candidate.parameters.append(allocateAbstractType(AbstractTexture { Types::Texture::Kind::TextureCubeArray, allocateAbstractType(S) }));
    candidate.result = allocateAbstractType(m_types.u32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureNumLayers :: (TextureDepth2dArray) -> U32
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.textureDepth2dArrayType()));
    candidate.result = allocateAbstractType(m_types.u32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureNumLayers :: (TextureDepthCubeArray) -> U32
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.textureDepthCubeArrayType()));
    candidate.result = allocateAbstractType(m_types.u32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureNumLayers :: <F, AM>(TextureStorage<Types::TextureStorage::Kind::TextureStorage2dArray, F, AM>) -> U32
    OverloadCandidate candidate;
    ValueVariable F { 0 };
    ValueVariable AM { 1 };
    candidate.valueVariables.append(F);
    candidate.valueVariables.append(AM);
    candidate.parameters.append(allocateAbstractType(AbstractTextureStorage { Types::TextureStorage::Kind::TextureStorage2dArray, F, AM }));
    candidate.result = allocateAbstractType(m_types.u32Type());
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("textureNumLevels"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureNumLevels :: <S is Concrete32BitNumber>(Texture<Types::Texture::Kind::Texture1d, S>) -> U32
    OverloadCandidate candidate;
    TypeVariable S { 0, Constraints::Concrete32BitNumber };
    candidate.typeVariables.append(S);
    candidate.parameters.append(allocateAbstractType(AbstractTexture { Types::Texture::Kind::Texture1d, allocateAbstractType(S) }));
    candidate.result = allocateAbstractType(m_types.u32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureNumLevels :: <S is Concrete32BitNumber>(Texture<Types::Texture::Kind::Texture2d, S>) -> U32
    OverloadCandidate candidate;
    TypeVariable S { 0, Constraints::Concrete32BitNumber };
    candidate.typeVariables.append(S);
    candidate.parameters.append(allocateAbstractType(AbstractTexture { Types::Texture::Kind::Texture2d, allocateAbstractType(S) }));
    candidate.result = allocateAbstractType(m_types.u32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureNumLevels :: <S is Concrete32BitNumber>(Texture<Types::Texture::Kind::Texture2dArray, S>) -> U32
    OverloadCandidate candidate;
    TypeVariable S { 0, Constraints::Concrete32BitNumber };
    candidate.typeVariables.append(S);
    candidate.parameters.append(allocateAbstractType(AbstractTexture { Types::Texture::Kind::Texture2dArray, allocateAbstractType(S) }));
    candidate.result = allocateAbstractType(m_types.u32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureNumLevels :: <S is Concrete32BitNumber>(Texture<Types::Texture::Kind::Texture3d, S>) -> U32
    OverloadCandidate candidate;
    TypeVariable S { 0, Constraints::Concrete32BitNumber };
    candidate.typeVariables.append(S);
    candidate.parameters.append(allocateAbstractType(AbstractTexture { Types::Texture::Kind::Texture3d, allocateAbstractType(S) }));
    candidate.result = allocateAbstractType(m_types.u32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureNumLevels :: <S is Concrete32BitNumber>(Texture<Types::Texture::Kind::TextureCube, S>) -> U32
    OverloadCandidate candidate;
    TypeVariable S { 0, Constraints::Concrete32BitNumber };
    candidate.typeVariables.append(S);
    candidate.parameters.append(allocateAbstractType(AbstractTexture { Types::Texture::Kind::TextureCube, allocateAbstractType(S) }));
    candidate.result = allocateAbstractType(m_types.u32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureNumLevels :: <S is Concrete32BitNumber>(Texture<Types::Texture::Kind::TextureCubeArray, S>) -> U32
    OverloadCandidate candidate;
    TypeVariable S { 0, Constraints::Concrete32BitNumber };
    candidate.typeVariables.append(S);
    candidate.parameters.append(allocateAbstractType(AbstractTexture { Types::Texture::Kind::TextureCubeArray, allocateAbstractType(S) }));
    candidate.result = allocateAbstractType(m_types.u32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureNumLevels :: (TextureDepth2d) -> U32
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.textureDepth2dType()));
    candidate.result = allocateAbstractType(m_types.u32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureNumLevels :: (TextureDepth2dArray) -> U32
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.textureDepth2dArrayType()));
    candidate.result = allocateAbstractType(m_types.u32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureNumLevels :: (TextureDepthCube) -> U32
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.textureDepthCubeType()));
    candidate.result = allocateAbstractType(m_types.u32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureNumLevels :: (TextureDepthCubeArray) -> U32
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.textureDepthCubeArrayType()));
    candidate.result = allocateAbstractType(m_types.u32Type());
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("textureNumSamples"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureNumSamples :: <S is Concrete32BitNumber>(Texture<Types::Texture::Kind::TextureMultisampled2d, S>) -> U32
    OverloadCandidate candidate;
    TypeVariable S { 0, Constraints::Concrete32BitNumber };
    candidate.typeVariables.append(S);
    candidate.parameters.append(allocateAbstractType(AbstractTexture { Types::Texture::Kind::TextureMultisampled2d, allocateAbstractType(S) }));
    candidate.result = allocateAbstractType(m_types.u32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureNumSamples :: (TextureDepthMultisampled2d) -> U32
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.textureDepthMultisampled2dType()));
    candidate.result = allocateAbstractType(m_types.u32Type());
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("textureSample"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSample :: (texture[Types::Texture::Kind::Texture1d, F32], Sampler, F32) -> vector[4, F32]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.textureType(Types::Texture::Kind::Texture1d, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.f32Type()));
    candidate.result = allocateAbstractType(m_types.vectorType(4, m_types.f32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSample :: (texture[Types::Texture::Kind::Texture2d, F32], Sampler, vector[2, F32]) -> vector[4, F32]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.textureType(Types::Texture::Kind::Texture2d, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.result = allocateAbstractType(m_types.vectorType(4, m_types.f32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSample :: (texture[Types::Texture::Kind::Texture2d, F32], Sampler, vector[2, F32], vector[2, I32]) -> vector[4, F32]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.textureType(Types::Texture::Kind::Texture2d, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.i32Type())));
    candidate.result = allocateAbstractType(m_types.vectorType(4, m_types.f32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSample :: <T is ConcreteInteger>(texture[Types::Texture::Kind::Texture2dArray, F32], Sampler, vector[2, F32], T) -> vector[4, F32]
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(m_types.textureType(Types::Texture::Kind::Texture2dArray, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(m_types.vectorType(4, m_types.f32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSample :: <T is ConcreteInteger>(texture[Types::Texture::Kind::Texture2dArray, F32], Sampler, vector[2, F32], T, vector[2, I32]) -> vector[4, F32]
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(m_types.textureType(Types::Texture::Kind::Texture2dArray, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.i32Type())));
    candidate.result = allocateAbstractType(m_types.vectorType(4, m_types.f32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSample :: (texture[Types::Texture::Kind::Texture3d, F32], Sampler, vector[3, F32]) -> vector[4, F32]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.textureType(Types::Texture::Kind::Texture3d, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(3, m_types.f32Type())));
    candidate.result = allocateAbstractType(m_types.vectorType(4, m_types.f32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSample :: (texture[Types::Texture::Kind::TextureCube, F32], Sampler, vector[3, F32]) -> vector[4, F32]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.textureType(Types::Texture::Kind::TextureCube, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(3, m_types.f32Type())));
    candidate.result = allocateAbstractType(m_types.vectorType(4, m_types.f32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSample :: (texture[Types::Texture::Kind::Texture3d, F32], Sampler, vector[3, F32], vector[3, I32]) -> vector[4, F32]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.textureType(Types::Texture::Kind::Texture3d, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(3, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(3, m_types.i32Type())));
    candidate.result = allocateAbstractType(m_types.vectorType(4, m_types.f32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSample :: <T is ConcreteInteger>(texture[Types::Texture::Kind::TextureCubeArray, F32], Sampler, vector[3, F32], T) -> vector[4, F32]
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(m_types.textureType(Types::Texture::Kind::TextureCubeArray, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(3, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(m_types.vectorType(4, m_types.f32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSample :: (TextureDepth2d, Sampler, vector[2, F32]) -> F32
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.textureDepth2dType()));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.result = allocateAbstractType(m_types.f32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSample :: (TextureDepth2d, Sampler, vector[2, F32], vector[2, I32]) -> F32
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.textureDepth2dType()));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.i32Type())));
    candidate.result = allocateAbstractType(m_types.f32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSample :: <T is ConcreteInteger>(TextureDepth2dArray, Sampler, vector[2, F32], T) -> F32
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(m_types.textureDepth2dArrayType()));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(m_types.f32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSample :: <T is ConcreteInteger>(TextureDepth2dArray, Sampler, vector[2, F32], T, vector[2, I32]) -> F32
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(m_types.textureDepth2dArrayType()));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.i32Type())));
    candidate.result = allocateAbstractType(m_types.f32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSample :: (TextureDepthCube, Sampler, vector[3, F32]) -> F32
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.textureDepthCubeType()));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(3, m_types.f32Type())));
    candidate.result = allocateAbstractType(m_types.f32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSample :: <T is ConcreteInteger>(TextureDepthCubeArray, Sampler, vector[3, F32], T) -> F32
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(m_types.textureDepthCubeArrayType()));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(3, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(m_types.f32Type());
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("textureSampleBias"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSampleBias :: (texture[Types::Texture::Kind::Texture2d, F32], Sampler, vector[2, F32], F32) -> vector[4, F32]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.textureType(Types::Texture::Kind::Texture2d, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.f32Type()));
    candidate.result = allocateAbstractType(m_types.vectorType(4, m_types.f32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSampleBias :: (texture[Types::Texture::Kind::Texture2d, F32], Sampler, vector[2, F32], F32, vector[2, I32]) -> vector[4, F32]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.textureType(Types::Texture::Kind::Texture2d, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.f32Type()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.i32Type())));
    candidate.result = allocateAbstractType(m_types.vectorType(4, m_types.f32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSampleBias :: <T is ConcreteInteger>(texture[Types::Texture::Kind::Texture2dArray, F32], Sampler, vector[2, F32], T, F32) -> vector[4, F32]
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(m_types.textureType(Types::Texture::Kind::Texture2dArray, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(m_types.f32Type()));
    candidate.result = allocateAbstractType(m_types.vectorType(4, m_types.f32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSampleBias :: <T is ConcreteInteger>(texture[Types::Texture::Kind::Texture2dArray, F32], Sampler, vector[2, F32], T, F32, vector[2, I32]) -> vector[4, F32]
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(m_types.textureType(Types::Texture::Kind::Texture2dArray, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(m_types.f32Type()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.i32Type())));
    candidate.result = allocateAbstractType(m_types.vectorType(4, m_types.f32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSampleBias :: (texture[Types::Texture::Kind::Texture3d, F32], Sampler, vector[3, F32], F32) -> vector[4, F32]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.textureType(Types::Texture::Kind::Texture3d, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(3, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.f32Type()));
    candidate.result = allocateAbstractType(m_types.vectorType(4, m_types.f32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSampleBias :: (texture[Types::Texture::Kind::TextureCube, F32], Sampler, vector[3, F32], F32) -> vector[4, F32]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.textureType(Types::Texture::Kind::TextureCube, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(3, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.f32Type()));
    candidate.result = allocateAbstractType(m_types.vectorType(4, m_types.f32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSampleBias :: (texture[Types::Texture::Kind::Texture3d, F32], Sampler, vector[3, F32], F32, vector[3, I32]) -> vector[4, F32]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.textureType(Types::Texture::Kind::Texture3d, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(3, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.f32Type()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(3, m_types.i32Type())));
    candidate.result = allocateAbstractType(m_types.vectorType(4, m_types.f32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSampleBias :: <T is ConcreteInteger>(texture[Types::Texture::Kind::TextureCubeArray, F32], Sampler, vector[3, F32], T, F32) -> vector[4, F32]
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(m_types.textureType(Types::Texture::Kind::TextureCubeArray, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(3, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(m_types.f32Type()));
    candidate.result = allocateAbstractType(m_types.vectorType(4, m_types.f32Type()));
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("textureSampleCompare"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSampleCompare :: (TextureDepth2d, SamplerComparison, vector[2, F32], F32) -> F32
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.textureDepth2dType()));
    candidate.parameters.append(allocateAbstractType(m_types.samplerComparisonType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.f32Type()));
    candidate.result = allocateAbstractType(m_types.f32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSampleCompare :: (TextureDepth2d, SamplerComparison, vector[2, F32], F32, vector[2, I32]) -> F32
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.textureDepth2dType()));
    candidate.parameters.append(allocateAbstractType(m_types.samplerComparisonType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.f32Type()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.i32Type())));
    candidate.result = allocateAbstractType(m_types.f32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSampleCompare :: <T is ConcreteInteger>(TextureDepth2dArray, SamplerComparison, vector[2, F32], T, F32) -> F32
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(m_types.textureDepth2dArrayType()));
    candidate.parameters.append(allocateAbstractType(m_types.samplerComparisonType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(m_types.f32Type()));
    candidate.result = allocateAbstractType(m_types.f32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSampleCompare :: <T is ConcreteInteger>(TextureDepth2dArray, SamplerComparison, vector[2, F32], T, F32, vector[2, I32]) -> F32
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(m_types.textureDepth2dArrayType()));
    candidate.parameters.append(allocateAbstractType(m_types.samplerComparisonType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(m_types.f32Type()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.i32Type())));
    candidate.result = allocateAbstractType(m_types.f32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSampleCompare :: (TextureDepthCube, SamplerComparison, vector[3, F32], F32) -> F32
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.textureDepthCubeType()));
    candidate.parameters.append(allocateAbstractType(m_types.samplerComparisonType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(3, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.f32Type()));
    candidate.result = allocateAbstractType(m_types.f32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSampleCompare :: <T is ConcreteInteger>(TextureDepthCubeArray, SamplerComparison, vector[3, F32], T, F32) -> F32
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(m_types.textureDepthCubeArrayType()));
    candidate.parameters.append(allocateAbstractType(m_types.samplerComparisonType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(3, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(m_types.f32Type()));
    candidate.result = allocateAbstractType(m_types.f32Type());
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("textureSampleCompareLevel"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSampleCompareLevel :: (TextureDepth2d, SamplerComparison, vector[2, F32], F32) -> F32
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.textureDepth2dType()));
    candidate.parameters.append(allocateAbstractType(m_types.samplerComparisonType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.f32Type()));
    candidate.result = allocateAbstractType(m_types.f32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSampleCompareLevel :: (TextureDepth2d, SamplerComparison, vector[2, F32], F32, vector[2, I32]) -> F32
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.textureDepth2dType()));
    candidate.parameters.append(allocateAbstractType(m_types.samplerComparisonType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.f32Type()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.i32Type())));
    candidate.result = allocateAbstractType(m_types.f32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSampleCompareLevel :: <T is ConcreteInteger>(TextureDepth2dArray, SamplerComparison, vector[2, F32], T, F32) -> F32
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(m_types.textureDepth2dArrayType()));
    candidate.parameters.append(allocateAbstractType(m_types.samplerComparisonType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(m_types.f32Type()));
    candidate.result = allocateAbstractType(m_types.f32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSampleCompareLevel :: <T is ConcreteInteger>(TextureDepth2dArray, SamplerComparison, vector[2, F32], T, F32, vector[2, I32]) -> F32
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(m_types.textureDepth2dArrayType()));
    candidate.parameters.append(allocateAbstractType(m_types.samplerComparisonType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(m_types.f32Type()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.i32Type())));
    candidate.result = allocateAbstractType(m_types.f32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSampleCompareLevel :: (TextureDepthCube, SamplerComparison, vector[3, F32], F32) -> F32
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.textureDepthCubeType()));
    candidate.parameters.append(allocateAbstractType(m_types.samplerComparisonType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(3, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.f32Type()));
    candidate.result = allocateAbstractType(m_types.f32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSampleCompareLevel :: <T is ConcreteInteger>(TextureDepthCubeArray, SamplerComparison, vector[3, F32], T, F32) -> F32
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(m_types.textureDepthCubeArrayType()));
    candidate.parameters.append(allocateAbstractType(m_types.samplerComparisonType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(3, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(m_types.f32Type()));
    candidate.result = allocateAbstractType(m_types.f32Type());
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("textureSampleGrad"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSampleGrad :: (texture[Types::Texture::Kind::Texture2d, F32], Sampler, vector[2, F32], vector[2, F32], vector[2, F32]) -> vector[4, F32]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.textureType(Types::Texture::Kind::Texture2d, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.result = allocateAbstractType(m_types.vectorType(4, m_types.f32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSampleGrad :: (texture[Types::Texture::Kind::Texture2d, F32], Sampler, vector[2, F32], vector[2, F32], vector[2, F32], vector[2, I32]) -> vector[4, F32]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.textureType(Types::Texture::Kind::Texture2d, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.i32Type())));
    candidate.result = allocateAbstractType(m_types.vectorType(4, m_types.f32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSampleGrad :: <T is ConcreteInteger>(texture[Types::Texture::Kind::Texture2dArray, F32], Sampler, vector[2, F32], T, vector[2, F32], vector[2, F32]) -> vector[4, F32]
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(m_types.textureType(Types::Texture::Kind::Texture2dArray, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.result = allocateAbstractType(m_types.vectorType(4, m_types.f32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSampleGrad :: <T is ConcreteInteger>(texture[Types::Texture::Kind::Texture2dArray, F32], Sampler, vector[2, F32], T, vector[2, F32], vector[2, F32], vector[2, I32]) -> vector[4, F32]
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(m_types.textureType(Types::Texture::Kind::Texture2dArray, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.i32Type())));
    candidate.result = allocateAbstractType(m_types.vectorType(4, m_types.f32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSampleGrad :: (texture[Types::Texture::Kind::Texture3d, F32], Sampler, vector[3, F32], vector[3, F32], vector[3, F32]) -> vector[4, F32]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.textureType(Types::Texture::Kind::Texture3d, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(3, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(3, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(3, m_types.f32Type())));
    candidate.result = allocateAbstractType(m_types.vectorType(4, m_types.f32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSampleGrad :: (texture[Types::Texture::Kind::TextureCube, F32], Sampler, vector[3, F32], vector[3, F32], vector[3, F32]) -> vector[4, F32]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.textureType(Types::Texture::Kind::TextureCube, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(3, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(3, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(3, m_types.f32Type())));
    candidate.result = allocateAbstractType(m_types.vectorType(4, m_types.f32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSampleGrad :: (texture[Types::Texture::Kind::Texture3d, F32], Sampler, vector[3, F32], vector[3, F32], vector[3, F32], vector[3, I32]) -> vector[4, F32]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.textureType(Types::Texture::Kind::Texture3d, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(3, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(3, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(3, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(3, m_types.i32Type())));
    candidate.result = allocateAbstractType(m_types.vectorType(4, m_types.f32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSampleGrad :: <T is ConcreteInteger>(texture[Types::Texture::Kind::TextureCubeArray, F32], Sampler, vector[3, F32], T, vector[3, F32], vector[3, F32]) -> vector[4, F32]
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(m_types.textureType(Types::Texture::Kind::TextureCubeArray, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(3, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(3, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(3, m_types.f32Type())));
    candidate.result = allocateAbstractType(m_types.vectorType(4, m_types.f32Type()));
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("textureSampleLevel"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSampleLevel :: (texture[Types::Texture::Kind::Texture1d, F32], Sampler, F32, F32) -> vector[4, F32]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.textureType(Types::Texture::Kind::Texture1d, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.f32Type()));
    candidate.parameters.append(allocateAbstractType(m_types.f32Type()));
    candidate.result = allocateAbstractType(m_types.vectorType(4, m_types.f32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSampleLevel :: (texture[Types::Texture::Kind::Texture2d, F32], Sampler, vector[2, F32], F32) -> vector[4, F32]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.textureType(Types::Texture::Kind::Texture2d, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.f32Type()));
    candidate.result = allocateAbstractType(m_types.vectorType(4, m_types.f32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSampleLevel :: (texture[Types::Texture::Kind::Texture2d, F32], Sampler, vector[2, F32], F32, vector[2, I32]) -> vector[4, F32]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.textureType(Types::Texture::Kind::Texture2d, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.f32Type()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.i32Type())));
    candidate.result = allocateAbstractType(m_types.vectorType(4, m_types.f32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSampleLevel :: <T is ConcreteInteger>(texture[Types::Texture::Kind::Texture2dArray, F32], Sampler, vector[2, F32], T, F32) -> vector[4, F32]
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(m_types.textureType(Types::Texture::Kind::Texture2dArray, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(m_types.f32Type()));
    candidate.result = allocateAbstractType(m_types.vectorType(4, m_types.f32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSampleLevel :: <T is ConcreteInteger>(texture[Types::Texture::Kind::Texture2dArray, F32], Sampler, vector[2, F32], T, F32, vector[2, I32]) -> vector[4, F32]
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(m_types.textureType(Types::Texture::Kind::Texture2dArray, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(m_types.f32Type()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.i32Type())));
    candidate.result = allocateAbstractType(m_types.vectorType(4, m_types.f32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSampleLevel :: (texture[Types::Texture::Kind::Texture3d, F32], Sampler, vector[3, F32], F32) -> vector[4, F32]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.textureType(Types::Texture::Kind::Texture3d, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(3, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.f32Type()));
    candidate.result = allocateAbstractType(m_types.vectorType(4, m_types.f32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSampleLevel :: (texture[Types::Texture::Kind::TextureCube, F32], Sampler, vector[3, F32], F32) -> vector[4, F32]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.textureType(Types::Texture::Kind::TextureCube, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(3, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.f32Type()));
    candidate.result = allocateAbstractType(m_types.vectorType(4, m_types.f32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSampleLevel :: (texture[Types::Texture::Kind::Texture3d, F32], Sampler, vector[3, F32], F32, vector[3, I32]) -> vector[4, F32]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.textureType(Types::Texture::Kind::Texture3d, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(3, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.f32Type()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(3, m_types.i32Type())));
    candidate.result = allocateAbstractType(m_types.vectorType(4, m_types.f32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSampleLevel :: <T is ConcreteInteger>(texture[Types::Texture::Kind::TextureCubeArray, F32], Sampler, vector[3, F32], T, F32) -> vector[4, F32]
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(m_types.textureType(Types::Texture::Kind::TextureCubeArray, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(3, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(m_types.f32Type()));
    candidate.result = allocateAbstractType(m_types.vectorType(4, m_types.f32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSampleLevel :: <T is ConcreteInteger>(TextureDepth2d, Sampler, vector[2, F32], T) -> F32
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(m_types.textureDepth2dType()));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(m_types.f32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSampleLevel :: <T is ConcreteInteger>(TextureDepth2d, Sampler, vector[2, F32], T, vector[2, I32]) -> F32
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(m_types.textureDepth2dType()));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.i32Type())));
    candidate.result = allocateAbstractType(m_types.f32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSampleLevel :: <S is ConcreteInteger, T is ConcreteInteger>(TextureDepth2dArray, Sampler, vector[2, F32], S, T) -> F32
    OverloadCandidate candidate;
    TypeVariable S { 0, Constraints::ConcreteInteger };
    TypeVariable T { 1, Constraints::ConcreteInteger };
    candidate.typeVariables.append(S);
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(m_types.textureDepth2dArrayType()));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(S));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(m_types.f32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSampleLevel :: <S is ConcreteInteger, T is ConcreteInteger>(TextureDepth2dArray, Sampler, vector[2, F32], S, T, vector[2, I32]) -> F32
    OverloadCandidate candidate;
    TypeVariable S { 0, Constraints::ConcreteInteger };
    TypeVariable T { 1, Constraints::ConcreteInteger };
    candidate.typeVariables.append(S);
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(m_types.textureDepth2dArrayType()));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(S));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.i32Type())));
    candidate.result = allocateAbstractType(m_types.f32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSampleLevel :: <T is ConcreteInteger>(TextureDepthCube, Sampler, vector[3, F32], T) -> F32
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(m_types.textureDepthCubeType()));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(3, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(m_types.f32Type());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSampleLevel :: <S is ConcreteInteger, T is ConcreteInteger>(TextureDepthCubeArray, Sampler, vector[3, F32], S, T) -> F32
    OverloadCandidate candidate;
    TypeVariable S { 0, Constraints::ConcreteInteger };
    TypeVariable T { 1, Constraints::ConcreteInteger };
    candidate.typeVariables.append(S);
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(m_types.textureDepthCubeArrayType()));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(3, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(S));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(m_types.f32Type());
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("textureSampleBaseClampToEdge"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSampleBaseClampToEdge :: (TextureExternal, Sampler, vector[2, F32]) -> vector[4, F32]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.textureExternalType()));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.result = allocateAbstractType(m_types.vectorType(4, m_types.f32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureSampleBaseClampToEdge :: (texture[Types::Texture::Kind::Texture2d, F32], Sampler, vector[2, F32]) -> vector[4, F32]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.textureType(Types::Texture::Kind::Texture2d, m_types.f32Type())));
    candidate.parameters.append(allocateAbstractType(m_types.samplerType()));
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.result = allocateAbstractType(m_types.vectorType(4, m_types.f32Type()));
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("textureStore"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = false,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureStore :: <F, T is ConcreteInteger>(TextureStorage<Types::TextureStorage::Kind::TextureStorage1d, F, AccessMode::Write>, T, Vector<4, ChannelFormat<F>>) -> Void
    OverloadCandidate candidate;
    ValueVariable F { 0 };
    TypeVariable T { 0, Constraints::ConcreteInteger };
    candidate.valueVariables.append(F);
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(AbstractTextureStorage { Types::TextureStorage::Kind::TextureStorage1d, F, AbstractValue { static_cast<unsigned>(AccessMode::Write) } }));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(AbstractChannelFormat { F }) }));
    candidate.result = allocateAbstractType(m_types.voidType());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureStore :: <F, T is ConcreteInteger>(TextureStorage<Types::TextureStorage::Kind::TextureStorage1d, F, AccessMode::ReadWrite>, T, Vector<4, ChannelFormat<F>>) -> Void
    OverloadCandidate candidate;
    ValueVariable F { 0 };
    TypeVariable T { 0, Constraints::ConcreteInteger };
    candidate.valueVariables.append(F);
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(AbstractTextureStorage { Types::TextureStorage::Kind::TextureStorage1d, F, AbstractValue { static_cast<unsigned>(AccessMode::ReadWrite) } }));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(AbstractChannelFormat { F }) }));
    candidate.result = allocateAbstractType(m_types.voidType());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureStore :: <F, T is ConcreteInteger>(TextureStorage<Types::TextureStorage::Kind::TextureStorage2d, F, AccessMode::Write>, Vector<2, T>, Vector<4, ChannelFormat<F>>) -> Void
    OverloadCandidate candidate;
    ValueVariable F { 0 };
    TypeVariable T { 0, Constraints::ConcreteInteger };
    candidate.valueVariables.append(F);
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(AbstractTextureStorage { Types::TextureStorage::Kind::TextureStorage2d, F, AbstractValue { static_cast<unsigned>(AccessMode::Write) } }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(AbstractChannelFormat { F }) }));
    candidate.result = allocateAbstractType(m_types.voidType());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureStore :: <F, T is ConcreteInteger>(TextureStorage<Types::TextureStorage::Kind::TextureStorage2d, F, AccessMode::ReadWrite>, Vector<2, T>, Vector<4, ChannelFormat<F>>) -> Void
    OverloadCandidate candidate;
    ValueVariable F { 0 };
    TypeVariable T { 0, Constraints::ConcreteInteger };
    candidate.valueVariables.append(F);
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(AbstractTextureStorage { Types::TextureStorage::Kind::TextureStorage2d, F, AbstractValue { static_cast<unsigned>(AccessMode::ReadWrite) } }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(AbstractChannelFormat { F }) }));
    candidate.result = allocateAbstractType(m_types.voidType());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureStore :: <F, T is ConcreteInteger, S is ConcreteInteger>(TextureStorage<Types::TextureStorage::Kind::TextureStorage2dArray, F, AccessMode::Write>, Vector<2, T>, S, Vector<4, ChannelFormat<F>>) -> Void
    OverloadCandidate candidate;
    ValueVariable F { 0 };
    TypeVariable T { 0, Constraints::ConcreteInteger };
    TypeVariable S { 1, Constraints::ConcreteInteger };
    candidate.valueVariables.append(F);
    candidate.typeVariables.append(T);
    candidate.typeVariables.append(S);
    candidate.parameters.append(allocateAbstractType(AbstractTextureStorage { Types::TextureStorage::Kind::TextureStorage2dArray, F, AbstractValue { static_cast<unsigned>(AccessMode::Write) } }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(S));
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(AbstractChannelFormat { F }) }));
    candidate.result = allocateAbstractType(m_types.voidType());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureStore :: <F, T is ConcreteInteger, S is ConcreteInteger>(TextureStorage<Types::TextureStorage::Kind::TextureStorage2dArray, F, AccessMode::ReadWrite>, Vector<2, T>, S, Vector<4, ChannelFormat<F>>) -> Void
    OverloadCandidate candidate;
    ValueVariable F { 0 };
    TypeVariable T { 0, Constraints::ConcreteInteger };
    TypeVariable S { 1, Constraints::ConcreteInteger };
    candidate.valueVariables.append(F);
    candidate.typeVariables.append(T);
    candidate.typeVariables.append(S);
    candidate.parameters.append(allocateAbstractType(AbstractTextureStorage { Types::TextureStorage::Kind::TextureStorage2dArray, F, AbstractValue { static_cast<unsigned>(AccessMode::ReadWrite) } }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(2) }, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(S));
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(AbstractChannelFormat { F }) }));
    candidate.result = allocateAbstractType(m_types.voidType());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureStore :: <F, T is ConcreteInteger>(TextureStorage<Types::TextureStorage::Kind::TextureStorage3d, F, AccessMode::Write>, Vector<3, T>, Vector<4, ChannelFormat<F>>) -> Void
    OverloadCandidate candidate;
    ValueVariable F { 0 };
    TypeVariable T { 0, Constraints::ConcreteInteger };
    candidate.valueVariables.append(F);
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(AbstractTextureStorage { Types::TextureStorage::Kind::TextureStorage3d, F, AbstractValue { static_cast<unsigned>(AccessMode::Write) } }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(3) }, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(AbstractChannelFormat { F }) }));
    candidate.result = allocateAbstractType(m_types.voidType());
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureStore :: <F, T is ConcreteInteger>(TextureStorage<Types::TextureStorage::Kind::TextureStorage3d, F, AccessMode::ReadWrite>, Vector<3, T>, Vector<4, ChannelFormat<F>>) -> Void
    OverloadCandidate candidate;
    ValueVariable F { 0 };
    TypeVariable T { 0, Constraints::ConcreteInteger };
    candidate.valueVariables.append(F);
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(AbstractTextureStorage { Types::TextureStorage::Kind::TextureStorage3d, F, AbstractValue { static_cast<unsigned>(AccessMode::ReadWrite) } }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(3) }, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(AbstractVector { AbstractValue { static_cast<unsigned>(4) }, allocateAbstractType(AbstractChannelFormat { F }) }));
    candidate.result = allocateAbstractType(m_types.voidType());
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("atomicLoad"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = false,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // atomicLoad :: <AS, T>(Pointer<AS, Atomic<T>, AccessMode::ReadWrite>) -> T
    OverloadCandidate candidate;
    ValueVariable AS { 0 };
    TypeVariable T { 0 };
    candidate.valueVariables.append(AS);
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(AbstractPointer { AS, allocateAbstractType(AbstractAtomic { allocateAbstractType(T) }), AbstractValue { static_cast<unsigned>(AccessMode::ReadWrite) } }));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("atomicStore"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = false,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // atomicStore :: <AS, T>(Pointer<AS, Atomic<T>, AccessMode::ReadWrite>, T) -> Void
    OverloadCandidate candidate;
    ValueVariable AS { 0 };
    TypeVariable T { 0 };
    candidate.valueVariables.append(AS);
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(AbstractPointer { AS, allocateAbstractType(AbstractAtomic { allocateAbstractType(T) }), AbstractValue { static_cast<unsigned>(AccessMode::ReadWrite) } }));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(m_types.voidType());
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("atomicAdd"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = false,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // atomicAdd :: <AS, T>(Pointer<AS, Atomic<T>, AccessMode::ReadWrite>, T) -> T
    OverloadCandidate candidate;
    ValueVariable AS { 0 };
    TypeVariable T { 0 };
    candidate.valueVariables.append(AS);
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(AbstractPointer { AS, allocateAbstractType(AbstractAtomic { allocateAbstractType(T) }), AbstractValue { static_cast<unsigned>(AccessMode::ReadWrite) } }));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("atomicSub"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = false,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // atomicSub :: <AS, T>(Pointer<AS, Atomic<T>, AccessMode::ReadWrite>, T) -> T
    OverloadCandidate candidate;
    ValueVariable AS { 0 };
    TypeVariable T { 0 };
    candidate.valueVariables.append(AS);
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(AbstractPointer { AS, allocateAbstractType(AbstractAtomic { allocateAbstractType(T) }), AbstractValue { static_cast<unsigned>(AccessMode::ReadWrite) } }));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("atomicMax"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = false,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // atomicMax :: <AS, T>(Pointer<AS, Atomic<T>, AccessMode::ReadWrite>, T) -> T
    OverloadCandidate candidate;
    ValueVariable AS { 0 };
    TypeVariable T { 0 };
    candidate.valueVariables.append(AS);
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(AbstractPointer { AS, allocateAbstractType(AbstractAtomic { allocateAbstractType(T) }), AbstractValue { static_cast<unsigned>(AccessMode::ReadWrite) } }));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("atomicMin"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = false,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // atomicMin :: <AS, T>(Pointer<AS, Atomic<T>, AccessMode::ReadWrite>, T) -> T
    OverloadCandidate candidate;
    ValueVariable AS { 0 };
    TypeVariable T { 0 };
    candidate.valueVariables.append(AS);
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(AbstractPointer { AS, allocateAbstractType(AbstractAtomic { allocateAbstractType(T) }), AbstractValue { static_cast<unsigned>(AccessMode::ReadWrite) } }));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("atomicAnd"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = false,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // atomicAnd :: <AS, T>(Pointer<AS, Atomic<T>, AccessMode::ReadWrite>, T) -> T
    OverloadCandidate candidate;
    ValueVariable AS { 0 };
    TypeVariable T { 0 };
    candidate.valueVariables.append(AS);
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(AbstractPointer { AS, allocateAbstractType(AbstractAtomic { allocateAbstractType(T) }), AbstractValue { static_cast<unsigned>(AccessMode::ReadWrite) } }));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("atomicOr"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = false,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // atomicOr :: <AS, T>(Pointer<AS, Atomic<T>, AccessMode::ReadWrite>, T) -> T
    OverloadCandidate candidate;
    ValueVariable AS { 0 };
    TypeVariable T { 0 };
    candidate.valueVariables.append(AS);
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(AbstractPointer { AS, allocateAbstractType(AbstractAtomic { allocateAbstractType(T) }), AbstractValue { static_cast<unsigned>(AccessMode::ReadWrite) } }));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("atomicXor"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = false,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // atomicXor :: <AS, T>(Pointer<AS, Atomic<T>, AccessMode::ReadWrite>, T) -> T
    OverloadCandidate candidate;
    ValueVariable AS { 0 };
    TypeVariable T { 0 };
    candidate.valueVariables.append(AS);
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(AbstractPointer { AS, allocateAbstractType(AbstractAtomic { allocateAbstractType(T) }), AbstractValue { static_cast<unsigned>(AccessMode::ReadWrite) } }));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("atomicExchange"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = false,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // atomicExchange :: <AS, T>(Pointer<AS, Atomic<T>, AccessMode::ReadWrite>, T) -> T
    OverloadCandidate candidate;
    ValueVariable AS { 0 };
    TypeVariable T { 0 };
    candidate.valueVariables.append(AS);
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(AbstractPointer { AS, allocateAbstractType(AbstractAtomic { allocateAbstractType(T) }), AbstractValue { static_cast<unsigned>(AccessMode::ReadWrite) } }));
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("atomicCompareExchangeWeak"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = false,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // atomicCompareExchangeWeak :: <AS>(Pointer<AS, atomic[I32], AccessMode::ReadWrite>, I32, I32) -> atomicCompareExchangeResult[I32]
    OverloadCandidate candidate;
    ValueVariable AS { 0 };
    candidate.valueVariables.append(AS);
    candidate.parameters.append(allocateAbstractType(AbstractPointer { AS, allocateAbstractType(m_types.atomicType(m_types.i32Type())), AbstractValue { static_cast<unsigned>(AccessMode::ReadWrite) } }));
    candidate.parameters.append(allocateAbstractType(m_types.i32Type()));
    candidate.parameters.append(allocateAbstractType(m_types.i32Type()));
    candidate.result = allocateAbstractType(m_types.atomicCompareExchangeResultType(m_types.i32Type()));
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // atomicCompareExchangeWeak :: <AS>(Pointer<AS, atomic[U32], AccessMode::ReadWrite>, U32, U32) -> atomicCompareExchangeResult[U32]
    OverloadCandidate candidate;
    ValueVariable AS { 0 };
    candidate.valueVariables.append(AS);
    candidate.parameters.append(allocateAbstractType(AbstractPointer { AS, allocateAbstractType(m_types.atomicType(m_types.u32Type())), AbstractValue { static_cast<unsigned>(AccessMode::ReadWrite) } }));
    candidate.parameters.append(allocateAbstractType(m_types.u32Type()));
    candidate.parameters.append(allocateAbstractType(m_types.u32Type()));
    candidate.result = allocateAbstractType(m_types.atomicCompareExchangeResultType(m_types.u32Type()));
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("pack4x8snorm"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantPack4x8snorm,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // pack4x8snorm :: (vector[4, F32]) -> U32
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(4, m_types.f32Type())));
    candidate.result = allocateAbstractType(m_types.u32Type());
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("pack4x8unorm"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantPack4x8unorm,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // pack4x8unorm :: (vector[4, F32]) -> U32
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(4, m_types.f32Type())));
    candidate.result = allocateAbstractType(m_types.u32Type());
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("pack4xI8"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantPack4xI8,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // pack4xI8 :: (vector[4, I32]) -> U32
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(4, m_types.i32Type())));
    candidate.result = allocateAbstractType(m_types.u32Type());
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("pack4xU8"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantPack4xU8,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // pack4xU8 :: (vector[4, U32]) -> U32
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(4, m_types.u32Type())));
    candidate.result = allocateAbstractType(m_types.u32Type());
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("pack4xI8Clamp"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantPack4xI8Clamp,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // pack4xI8Clamp :: (vector[4, I32]) -> U32
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(4, m_types.i32Type())));
    candidate.result = allocateAbstractType(m_types.u32Type());
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("pack4xU8Clamp"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantPack4xU8Clamp,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // pack4xU8Clamp :: (vector[4, U32]) -> U32
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(4, m_types.u32Type())));
    candidate.result = allocateAbstractType(m_types.u32Type());
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("pack2x16snorm"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantPack2x16snorm,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // pack2x16snorm :: (vector[2, F32]) -> U32
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.result = allocateAbstractType(m_types.u32Type());
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("pack2x16unorm"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantPack2x16unorm,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // pack2x16unorm :: (vector[2, F32]) -> U32
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.result = allocateAbstractType(m_types.u32Type());
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("pack2x16float"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantPack2x16float,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // pack2x16float :: (vector[2, F32]) -> U32
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.vectorType(2, m_types.f32Type())));
    candidate.result = allocateAbstractType(m_types.u32Type());
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("unpack4x8snorm"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantUnpack4x8snorm,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // unpack4x8snorm :: (U32) -> vector[4, F32]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.u32Type()));
    candidate.result = allocateAbstractType(m_types.vectorType(4, m_types.f32Type()));
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("unpack4x8unorm"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantUnpack4x8unorm,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // unpack4x8unorm :: (U32) -> vector[4, F32]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.u32Type()));
    candidate.result = allocateAbstractType(m_types.vectorType(4, m_types.f32Type()));
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("unpack4xI8"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantUnpack4xI8,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // unpack4xI8 :: (U32) -> vector[4, I32]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.u32Type()));
    candidate.result = allocateAbstractType(m_types.vectorType(4, m_types.i32Type()));
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("unpack4xU8"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantUnpack4xU8,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // unpack4xU8 :: (U32) -> vector[4, U32]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.u32Type()));
    candidate.result = allocateAbstractType(m_types.vectorType(4, m_types.u32Type()));
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("unpack2x16snorm"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantUnpack2x16snorm,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // unpack2x16snorm :: (U32) -> vector[2, F32]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.u32Type()));
    candidate.result = allocateAbstractType(m_types.vectorType(2, m_types.f32Type()));
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("unpack2x16unorm"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantUnpack2x16unorm,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // unpack2x16unorm :: (U32) -> vector[2, F32]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.u32Type()));
    candidate.result = allocateAbstractType(m_types.vectorType(2, m_types.f32Type()));
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("unpack2x16float"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = constantUnpack2x16float,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute, ShaderStage::Vertex },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // unpack2x16float :: (U32) -> vector[2, F32]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.u32Type()));
    candidate.result = allocateAbstractType(m_types.vectorType(2, m_types.f32Type()));
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("storageBarrier"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = false,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Compute },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // storageBarrier :: () -> Void
    OverloadCandidate candidate;
    candidate.result = allocateAbstractType(m_types.voidType());
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("textureBarrier"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = false,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Compute },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // textureBarrier :: () -> Void
    OverloadCandidate candidate;
    candidate.result = allocateAbstractType(m_types.voidType());
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("workgroupBarrier"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = false,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Compute },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // workgroupBarrier :: () -> Void
    OverloadCandidate candidate;
    candidate.result = allocateAbstractType(m_types.voidType());
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("workgroupUniformLoad"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Compute },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // workgroupUniformLoad :: <T>(Pointer<AddressSpace::Workgroup, Atomic<T>>) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0 };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(AbstractPointer { AbstractValue { static_cast<unsigned>(AddressSpace::Workgroup) }, allocateAbstractType(AbstractAtomic { allocateAbstractType(T) }) }));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // workgroupUniformLoad :: <T>(Pointer<AddressSpace::Workgroup, T>) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0 };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(AbstractPointer { AbstractValue { static_cast<unsigned>(AddressSpace::Workgroup) }, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("subgroupAdd"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // subgroupAdd :: <T is ConcreteNumber>(T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteNumber };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // subgroupAdd :: <T is ConcreteNumber, N>(Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteNumber };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("subgroupExclusiveAdd"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // subgroupExclusiveAdd :: <T is ConcreteNumber>(T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteNumber };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // subgroupExclusiveAdd :: <T is ConcreteNumber, N>(Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteNumber };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("subgroupInclusiveAdd"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // subgroupInclusiveAdd :: <T is ConcreteNumber>(T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteNumber };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // subgroupInclusiveAdd :: <T is ConcreteNumber, N>(Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteNumber };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("subgroupMul"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // subgroupMul :: <T is ConcreteNumber>(T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteNumber };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // subgroupMul :: <T is ConcreteNumber, N>(Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteNumber };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("subgroupExclusiveMul"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // subgroupExclusiveMul :: <T is ConcreteNumber>(T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteNumber };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // subgroupExclusiveMul :: <T is ConcreteNumber, N>(Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteNumber };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("subgroupInclusiveMul"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // subgroupInclusiveMul :: <T is ConcreteNumber>(T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteNumber };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // subgroupInclusiveMul :: <T is ConcreteNumber, N>(Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteNumber };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("subgroupMax"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // subgroupMax :: <T is ConcreteNumber>(T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteNumber };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // subgroupMax :: <T is ConcreteNumber, N>(Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteNumber };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("subgroupMin"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // subgroupMin :: <T is ConcreteNumber>(T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteNumber };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // subgroupMin :: <T is ConcreteNumber, N>(Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteNumber };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("subgroupBroadcastFirst"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // subgroupBroadcastFirst :: <T is ConcreteNumber>(T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteNumber };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // subgroupBroadcastFirst :: <T is ConcreteNumber, N>(Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteNumber };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("subgroupAnd"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // subgroupAnd :: <T is ConcreteInteger>(T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // subgroupAnd :: <T is ConcreteInteger, N>(Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("subgroupOr"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // subgroupOr :: <T is ConcreteInteger>(T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // subgroupOr :: <T is ConcreteInteger, N>(Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("subgroupXor"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // subgroupXor :: <T is ConcreteInteger>(T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // subgroupXor :: <T is ConcreteInteger, N>(Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteInteger };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("subgroupAll"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // subgroupAll :: (Bool) -> Bool
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.boolType()));
    candidate.result = allocateAbstractType(m_types.boolType());
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("subgroupAny"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // subgroupAny :: (Bool) -> Bool
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.boolType()));
    candidate.result = allocateAbstractType(m_types.boolType());
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("subgroupBallot"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // subgroupBallot :: (Bool) -> vector[4, U32]
    OverloadCandidate candidate;
    candidate.parameters.append(allocateAbstractType(m_types.boolType()));
    candidate.result = allocateAbstractType(m_types.vectorType(4, m_types.u32Type()));
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("subgroupElect"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // subgroupElect :: () -> Bool
    OverloadCandidate candidate;
    candidate.result = allocateAbstractType(m_types.boolType());
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("subgroupBroadcast"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = nullptr,
    .validationFunction = validateSubgroupBroadcast,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // subgroupBroadcast :: <T is ConcreteNumber, U is ConcreteInteger>(T, U) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteNumber };
    TypeVariable U { 1, Constraints::ConcreteInteger };
    candidate.typeVariables.append(T);
    candidate.typeVariables.append(U);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(U));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // subgroupBroadcast :: <T is ConcreteNumber, N, U is ConcreteInteger>(Vector<N, T>, U) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteNumber };
    ValueVariable N { 0 };
    TypeVariable U { 1, Constraints::ConcreteInteger };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.typeVariables.append(U);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(U));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("subgroupShuffle"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = nullptr,
    .validationFunction = validateSubgroupShuffle,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // subgroupShuffle :: <T is ConcreteNumber, U is ConcreteInteger>(T, U) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteNumber };
    TypeVariable U { 1, Constraints::ConcreteInteger };
    candidate.typeVariables.append(T);
    candidate.typeVariables.append(U);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(U));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // subgroupShuffle :: <T is ConcreteNumber, N, U is ConcreteInteger>(Vector<N, T>, U) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteNumber };
    ValueVariable N { 0 };
    TypeVariable U { 1, Constraints::ConcreteInteger };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.typeVariables.append(U);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(U));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("subgroupShuffleDown"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = nullptr,
    .validationFunction = validateSubgroupShuffle,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // subgroupShuffleDown :: <T is ConcreteNumber>(T, U32) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteNumber };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(m_types.u32Type()));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // subgroupShuffleDown :: <T is ConcreteNumber, N>(Vector<N, T>, U32) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteNumber };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(m_types.u32Type()));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("subgroupShuffleUp"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = nullptr,
    .validationFunction = validateSubgroupShuffle,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // subgroupShuffleUp :: <T is ConcreteNumber>(T, U32) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteNumber };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(m_types.u32Type()));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // subgroupShuffleUp :: <T is ConcreteNumber, N>(Vector<N, T>, U32) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteNumber };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(m_types.u32Type()));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("subgroupShuffleXor"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = nullptr,
    .validationFunction = validateSubgroupShuffle,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // subgroupShuffleXor :: <T is ConcreteNumber>(T, U32) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteNumber };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(m_types.u32Type()));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // subgroupShuffleXor :: <T is ConcreteNumber, N>(Vector<N, T>, U32) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteNumber };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(m_types.u32Type()));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("quadBroadcast"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = nullptr,
    .validationFunction = validateQuadBroadcast,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // quadBroadcast :: <T is ConcreteNumber, U is ConcreteInteger>(T, U) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteNumber };
    TypeVariable U { 1, Constraints::ConcreteInteger };
    candidate.typeVariables.append(T);
    candidate.typeVariables.append(U);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.parameters.append(allocateAbstractType(U));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // quadBroadcast :: <T is ConcreteNumber, N, U is ConcreteInteger>(Vector<N, T>, U) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteNumber };
    ValueVariable N { 0 };
    TypeVariable U { 1, Constraints::ConcreteInteger };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.typeVariables.append(U);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.parameters.append(allocateAbstractType(U));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("quadSwapDiagonal"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // quadSwapDiagonal :: <T is ConcreteNumber>(T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteNumber };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // quadSwapDiagonal :: <T is ConcreteNumber, N>(Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteNumber };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("quadSwapX"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // quadSwapX :: <T is ConcreteNumber>(T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteNumber };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // quadSwapX :: <T is ConcreteNumber, N>(Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteNumber };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

{
auto result = m_overloadedOperations.add("quadSwapY"_s, OverloadedDeclaration {
    .kind = OverloadedDeclaration::Function,
    .mustUse = true,
    .constantFunction = nullptr,
    .validationFunction = nullptr,
    .visibility = { ShaderStage::Fragment, ShaderStage::Compute },
    .overloads = { }
});
ASSERT_UNUSED(result, result.isNewEntry);
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // quadSwapY :: <T is ConcreteNumber>(T) -> T
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteNumber };
    candidate.typeVariables.append(T);
    candidate.parameters.append(allocateAbstractType(T));
    candidate.result = allocateAbstractType(T);
    return candidate;
}()));
result.iterator->value.overloads.append(([&]() -> OverloadCandidate {
    // quadSwapY :: <T is ConcreteNumber, N>(Vector<N, T>) -> Vector<N, T>
    OverloadCandidate candidate;
    TypeVariable T { 0, Constraints::ConcreteNumber };
    ValueVariable N { 0 };
    candidate.typeVariables.append(T);
    candidate.valueVariables.append(N);
    candidate.parameters.append(allocateAbstractType(AbstractVector { N, allocateAbstractType(T) }));
    candidate.result = allocateAbstractType(AbstractVector { N, allocateAbstractType(T) });
    return candidate;
}()));
}

