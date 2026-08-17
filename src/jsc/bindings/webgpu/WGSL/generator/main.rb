class Constraint
    attr_reader :name

    def initialize(name)
        @name = name
    end

    def to_s
        name.to_s
    end

    def self.from_type(type)
        Constraint.new type.name
    end

    def to_cpp
        "Constraints::#{self}"
    end
end

class VariableKind
    attr_accessor :name

    def initialize(name)
        @name = name
    end

    def to_s
        name.to_s
    end
end

class Variable
    attr_reader :name, :kind, :constraint
    def initialize(name, kind, constraint=nil)
        @name = name
        @kind = kind
        @constraint = constraint
    end

    def <(constraint)
        raise "Expected a Constraint, found: #{constraint.class} "unless constraint.class == Constraint
        Variable.new(@name, @kind, constraint)
    end

    def to_s
        constraint = " is #{@constraint.to_s}" if @constraint
        "#{@name.to_s}#{constraint}"
    end

    def to_cpp
        if @kind == DSL::type_variable
            "allocateAbstractType(#{@name.to_s})"
        else
            @name.to_s
        end
    end

    def is_abstract?
        @kind != nil
    end

    def declaration(context)
        index = context[kind]
        context[kind] += 1
        constraint = ", #{@constraint.to_cpp}" if @constraint
        "#{kind} #{name} { #{index}#{constraint} };"
    end

    def append
        if @kind == DSL::type_variable
            "candidate.typeVariables.append(#{name});"
        else
            "candidate.valueVariables.append(#{name});"
        end
    end
end

class AbstractValue
    attr_reader :value

    def initialize(value)
        @value = value
    end

    def is_abstract?
        false
    end

    def to_s
      value.to_s
    end

    def to_cpp
        "AbstractValue { static_cast<unsigned>(#{value}) }"
    end
end

class AbstractType
    attr_reader :name

    def initialize(name)
        @name = name
    end

    def [](*arguments)
        arguments.map! do |argument|
            if argument.is_a? Integer
                AbstractValue.new(argument)
            else
                argument
            end
        end

        # This is a bit hacky, but the idea is that types such as Vector can
        # either become:
        # 1) An AbstractType, if it receives a variable. This AbstractType will
        #    later be promoted to a concrete type once an overload is chosen.
        # 2) A concrete type if it's given a concrete type. Since there are no
        #    variables involved, we can immediately construct a concrete type.
        if arguments.any? do |arg| arg.is_abstract? end
            ParameterizedAbstractType.new(self, arguments)
        else
            Constructor.new(@name.downcase, arguments)
        end
    end

    def is_abstract?
        true
    end

    def to_s
        @name.to_s
    end
end

class Constructor
    attr_reader :name, :arguments

    def initialize(name, arguments)
        @name = name
        @arguments = arguments
    end

    def to_s
        "#{name.to_s}[#{arguments.map(&:to_s).join(", ")}]"
    end

    def is_abstract?
        false
    end

    def concrete_type
        "m_types.#{name}Type(#{arguments.map { |a| a.respond_to? :concrete_type and a.concrete_type or a}.join ", "})"
    end

    def to_cpp
        "allocateAbstractType(#{concrete_type})"
    end
end

class PrimitiveType
    attr_reader :name

    def initialize(name)
        @name = name
    end

    def to_s
        @name.to_s
    end

    def is_abstract?
        false
    end

    def concrete_type
        "m_types.#{name[0].downcase}#{name[1..]}Type()"
    end

    def to_cpp
        "allocateAbstractType(#{concrete_type})"
    end
end

class ParameterizedAbstractType
    attr_reader :base, :arguments

    def initialize(base, arguments)
        @base = base
        @arguments = arguments
    end

    def is_abstract?
        true
    end

    def to_s
        "#{base}<#{arguments.join(", ")}>"
    end

    def to_cpp
        "allocateAbstractType(Abstract#{base} { #{arguments.map(&:to_cpp).join ", "} })"
    end
end

class FunctionType
    attr_accessor :variables,  :parameters, :return_type

    def initialize(variables, parameters, return_type=nil)
        @variables = variables
        @parameters = parameters
        @return_type = return_type
    end

    def to_s
        variables = "<#{@variables.join(', ')}>" unless @variables.empty?
        "#{variables}(#{@parameters.join(', ')}) -> #{@return_type.to_s}"
    end

    def to_cpp(name)
        context = {
            DSL::type_variable => 0,
            DSL::numeric_variable => 0,
        }
        out = []
        out << "([&]() -> OverloadCandidate {"

        def append(name)
            "candidate.parameters.append(#{name});"
        end

        prefix = "    "
        out << prefix + "// #{name} :: #{to_s}"
        out << prefix + "OverloadCandidate candidate;"
        out += variables.map { |v| prefix + v.declaration(context) }
        out += variables.map { |v| prefix + v.append }
        out += parameters.map { |p| prefix + append(p.to_cpp) }
        out << prefix + "candidate.result = #{return_type.to_cpp};"
        out << prefix + "return candidate;"
        out << "}())"
        out.join "\n"
    end
end

class Array
    def call(*arguments)
        FunctionType.new(self, arguments)
    end
end

class AggregateConstructor
    # allows constructing ParameterizedAbstractTypes in multiple invocations/steps
    # e.g. vec[2][T] to construct Vector[2, T]
    #
    # the second argument `steps` is used to validate how many arguments are accepted per step
    # e.g. [s0, s1, ..., sn] will accept x[A0..As0]...[A0..Asn]
    #
    # A concrete example is matrix below, which uses steps [2, 1]:
    # - the first step takes 2 arguments: number of columns and number of rows
    # - the second step takes 1 argument: the element type of the matrix
    def initialize(constructor, steps, values = [])
        @constructor = constructor
        @steps = steps
        @values = values
    end

    def [](*args)
        expected = @steps[0]

        if args.length != expected
            raise "Unexpected number of arguments for constructor: expected #{expected}, got #{args.length}"
        end

        values = @values + args

        if @steps.length > 1
            AggregateConstructor.new(@constructor, @steps[1..], values)
        else
            @constructor[*values]
        end
    end
end

module DSL
    @context = binding()
    @aliases = {}
    @entries = {}
    @TypeVariable = VariableKind.new(:TypeVariable)
    @ValueVariable = VariableKind.new(:ValueVariable)

    def self.type_variable
        @TypeVariable
    end

    def self.numeric_variable
        @ValueVariable
    end

    def self.add_entry(kind, name, map)
        overloads = []
        properties = {
            must_use: false,
            const: false,
            validate: false,
            stage: [:fragment, :compute, :vertex],
        }
        map.each do |key, value|
            if key.kind_of? FunctionType
                key.return_type = value
                overloads << key
            else
                properties[key] = value
            end
        end

        existing_entry = @entries[name]
        if !existing_entry
            @entries[name] = {
                **properties,
                kind: kind,
                overloads: overloads
            }
            return
        end


        properties.each do |key, value|
            if existing_entry[key] != value then
                raise "Incompatible overload: key: #{key}, existing value: #{existing_entry[key]}, new value: #{value}"
            end
        end
        existing_entry[:overloads] += overloads
    end

    def self.operator(name, map)
        add_entry(:operator, name, map)
    end

    def self.constructor(name, map)
        add_entry(:constructor, name, map)
    end

    def self.function(name, map)
        add_entry(:function, name, map)
    end

    def self.type_alias(name, type)
        @aliases[name] = type
    end

    def self.declarations_to_cpp
        out = []

        @aliases.each do |name, type|
            out << "CHECK(introduceType(AST::Identifier::make(\"#{name}\"_s), #{type.concrete_type}));"
        end

        out << "" # xcode compilation fails if there's not newline at the end of the file
        out.join "\n"
    end

    def self.overloads_to_cpp
        out = []

        @entries.each do |name, entry|
            constant_function = case entry[:const]
            when false
                "nullptr"
            when true
                "constant#{name[0].upcase}#{name[1..]}"
            else
                entry[:const]
            end

            validation_function = case entry[:validate]
            when false
                "nullptr"
            when true
                "validate#{name[0].upcase}#{name[1..]}"
            else
                entry[:validate]
            end

            stages = entry[:stage].kind_of?(Array) ? entry[:stage] : [entry[:stage]]
            visibility = stages.map { |s| "ShaderStage::#{s.to_s.capitalize}" }.join ", "

            out << "{"
            out << "auto result = m_overloadedOperations.add(\"#{name}\"_s, OverloadedDeclaration {"
            out << "    .kind = OverloadedDeclaration::#{entry[:kind].to_s.capitalize},"
            out << "    .mustUse = #{entry[:must_use]},"
            out << "    .constantFunction = #{constant_function},"
            out << "    .validationFunction = #{validation_function},"
            out << "    .visibility = { #{visibility} },"
            out << "    .overloads = { }"
            out << "});"
            out << "ASSERT_UNUSED(result, result.isNewEntry);"
            entry[:overloads].each do |function|
                out << "result.iterator->value.overloads.append(#{function.to_cpp(name)});"
            end
            out << "}"
            out << ""
        end

        out << "" # xcode compilation fails if there's not newline at the end of the file
        out.join "\n"
    end

    def self.prologue
        @context.eval <<~EOS
        # abstract types
        Vector = AbstractType.new(:Vector)
        Matrix = AbstractType.new(:Matrix)
        Texture = AbstractType.new(:Texture)
        TextureStorage = AbstractType.new(:TextureStorage)
        ChannelFormat = AbstractType.new(:ChannelFormat)

        array = AbstractType.new(:Array)
        ptr = AbstractType.new(:Pointer)
        ref = AbstractType.new(:Reference)
        atomic = AbstractType.new(:Atomic)

        # texture kinds
        Texture1d = Variable.new(:"Types::Texture::Kind::Texture1d", nil)
        Texture2d = Variable.new(:"Types::Texture::Kind::Texture2d", nil)
        TextureMultisampled2d = Variable.new(:"Types::Texture::Kind::TextureMultisampled2d", nil)
        Texture2dArray = Variable.new(:"Types::Texture::Kind::Texture2dArray", nil)
        Texture3d = Variable.new(:"Types::Texture::Kind::Texture3d", nil)
        TextureCube = Variable.new(:"Types::Texture::Kind::TextureCube", nil)
        TextureCubeArray = Variable.new(:"Types::Texture::Kind::TextureCubeArray", nil)

        # texture storage kinds
        TextureStorage1d = Variable.new(:"Types::TextureStorage::Kind::TextureStorage1d", nil)
        TextureStorage2d = Variable.new(:"Types::TextureStorage::Kind::TextureStorage2d", nil)
        TextureStorage2dArray = Variable.new(:"Types::TextureStorage::Kind::TextureStorage2dArray", nil)
        TextureStorage3d = Variable.new(:"Types::TextureStorage::Kind::TextureStorage3d", nil)

        # Variables
        S = Variable.new(:S, @TypeVariable)
        T = Variable.new(:T, @TypeVariable)
        U = Variable.new(:U, @TypeVariable)
        V = Variable.new(:V, @TypeVariable)

        N = Variable.new(:N, @ValueVariable)
        C = Variable.new(:C, @ValueVariable)
        R = Variable.new(:R, @ValueVariable)
        K = Variable.new(:K, @ValueVariable)
        AS = Variable.new(:AS, @ValueVariable)
        F = Variable.new(:F, @ValueVariable)
        AM = Variable.new(:AM, @ValueVariable)

        # constraints
        Number = Constraint.new(:Number)
        Integer = Constraint.new(:Integer)
        Float = Constraint.new(:Float)
        Scalar = Constraint.new(:Scalar)
        ConcreteInteger = Constraint.new(:ConcreteInteger)
        ConcreteFloat = Constraint.new(:ConcreteFloat)
        ConcreteScalar = Constraint.new(:ConcreteScalar)
        Concrete32BitNumber = Constraint.new(:Concrete32BitNumber)
        SignedNumber = Constraint.new(:SignedNumber)
        ConcreteNumber = Constraint.new(:ConcreteNumber)

        # primitives
        void = PrimitiveType.new(:Void)
        bool = PrimitiveType.new(:Bool)
        i32 = PrimitiveType.new(:I32)
        u32 = PrimitiveType.new(:U32)
        f32 = PrimitiveType.new(:F32)
        f16 = PrimitiveType.new(:F16)
        sampler = PrimitiveType.new(:Sampler)
        sampler_comparison = PrimitiveType.new(:SamplerComparison)
        texture_external = PrimitiveType.new(:TextureExternal)
        abstract_int = PrimitiveType.new(:AbstractInt)
        abstract_float = PrimitiveType.new(:AbstractFloat)

        texture_depth_2d = PrimitiveType.new(:TextureDepth2d)
        texture_depth_2d_array = PrimitiveType.new(:TextureDepth2dArray)
        texture_depth_cube = PrimitiveType.new(:TextureDepthCube)
        texture_depth_cube_array = PrimitiveType.new(:TextureDepthCubeArray)
        texture_depth_multisampled_2d = PrimitiveType.new(:TextureDepthMultisampled2d)

        storage = AbstractValue.new(:"AddressSpace::Storage")
        workgroup = AbstractValue.new(:"AddressSpace::Workgroup")

        read = AbstractValue.new(:"AccessMode::Read")
        read_write = AbstractValue.new(:"AccessMode::ReadWrite")
        write = AbstractValue.new(:"AccessMode::Write")

        # helpers
        vec = AggregateConstructor.new(Vector, [1, 1])
        mat = AggregateConstructor.new(Matrix, [2, 1])
        texture = AggregateConstructor.new(Texture, [1, 1])
        texture_storage = AggregateConstructor.new(TextureStorage, [1, 2])

        vec2 = vec[2]
        vec3 = vec[3]
        vec4 = vec[4]

        mat2x2 = mat[2,2]
        mat2x3 = mat[2,3]
        mat2x4 = mat[2,4]
        mat3x2 = mat[3,2]
        mat3x3 = mat[3,3]
        mat3x4 = mat[3,4]
        mat4x2 = mat[4,2]
        mat4x3 = mat[4,3]
        mat4x4 = mat[4,4]

        texture_1d = texture[Texture1d]
        texture_2d = texture[Texture2d]
        texture_multisampled_2d = texture[TextureMultisampled2d]
        texture_2d_array = texture[Texture2dArray]
        texture_3d = texture[Texture3d]
        texture_cube = texture[TextureCube]
        texture_cube_array = texture[TextureCubeArray]

        texture_storage_1d = texture_storage[TextureStorage1d]
        texture_storage_2d = texture_storage[TextureStorage2d]
        texture_storage_2d_array = texture_storage[TextureStorage2dArray]
        texture_storage_3d = texture_storage[TextureStorage3d]

        # primitive structs

        __frexp_result_abstract = Constructor.new(:frexpResult, [abstract_float, abstract_int])
        __frexp_result_f16 = Constructor.new(:frexpResult, [f16, i32])
        __frexp_result_f32 = Constructor.new(:frexpResult, [f32, i32])

        __frexp_result_vec2_abstract = Constructor.new(:frexpResult, [vec2[abstract_float], vec2[abstract_int]])
        __frexp_result_vec2_f16 = Constructor.new(:frexpResult, [vec2[f16], vec2[i32]])
        __frexp_result_vec2_f32 = Constructor.new(:frexpResult, [vec2[f32], vec2[i32]])

        __frexp_result_vec3_abstract = Constructor.new(:frexpResult, [vec3[abstract_float], vec3[abstract_int]])
        __frexp_result_vec3_f16 = Constructor.new(:frexpResult, [vec3[f16], vec3[i32]])
        __frexp_result_vec3_f32 = Constructor.new(:frexpResult, [vec3[f32], vec3[i32]])

        __frexp_result_vec4_abstract = Constructor.new(:frexpResult, [vec4[abstract_float], vec4[abstract_int]])
        __frexp_result_vec4_f16 = Constructor.new(:frexpResult, [vec4[f16], vec4[i32]])
        __frexp_result_vec4_f32 = Constructor.new(:frexpResult, [vec4[f32], vec4[i32]])

        __modf_result_abstract = Constructor.new(:modfResult, [abstract_float, abstract_float])
        __modf_result_f16 = Constructor.new(:modfResult, [f16, f16])
        __modf_result_f32 = Constructor.new(:modfResult, [f32, f32])

        __modf_result_vec2_abstract = Constructor.new(:modfResult, [vec2[abstract_float], vec2[abstract_float]])
        __modf_result_vec2_f16 = Constructor.new(:modfResult, [vec2[f16], vec2[f16]])
        __modf_result_vec2_f32 = Constructor.new(:modfResult, [vec2[f32], vec2[f32]])

        __modf_result_vec3_abstract = Constructor.new(:modfResult, [vec3[abstract_float], vec3[abstract_float]])
        __modf_result_vec3_f16 = Constructor.new(:modfResult, [vec3[f16], vec3[f16]])
        __modf_result_vec3_f32 = Constructor.new(:modfResult, [vec3[f32], vec3[f32]])

        __modf_result_vec4_abstract = Constructor.new(:modfResult, [vec4[abstract_float], vec4[abstract_float]])
        __modf_result_vec4_f16 = Constructor.new(:modfResult, [vec4[f16], vec4[f16]])
        __modf_result_vec4_f32 = Constructor.new(:modfResult, [vec4[f32], vec4[f32]])

        __atomic_compare_exchange_result_i32 = Constructor.new(:atomicCompareExchangeResult, [i32])
        __atomic_compare_exchange_result_u32 = Constructor.new(:atomicCompareExchangeResult, [u32])
        EOS
    end

    def self.run(file)
        @context.eval(File.open(file).read, file)
    end

    def self.write_to(output_declarations, output_overloads)
        File.open(output_declarations, 'w') { |file| file.write(declarations_to_cpp) }
        File.open(output_overloads, 'w') { |file| file.write(overloads_to_cpp) }
    end
end

raise "usage: #{__FILE__} <declaration-file> <output-type-declarations> <output-type-overloads>" if ARGV.length != 3
input = ARGV[0]
output_declarations = ARGV[1]
output_overloads = ARGV[2]

DSL::prologue()
DSL::run(input)
DSL::write_to(output_declarations, output_overloads)
